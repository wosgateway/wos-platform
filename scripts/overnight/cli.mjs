// Shared CLI for `ai:agent` (interactive, one task) and `ai:overnight` (long run). Never commits, pushes or deploys.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inspectText, redact, safeJson, WITHHELD } from "./sanitize.mjs";
import { createGuard, DEFAULT_WRITE_SCOPE, parseDuration } from "./guard.mjs";
import { runGate } from "./gate.mjs";
import { supervise, formatReport, DEFAULTS } from "./supervisor.mjs";

const VALUE_FLAGS = new Set(["--task", "--task-file", "--max-iterations", "--timeout", "--failure-limit", "--no-improve-limit", "--scope", "--file", "--base-url", "--model", "--provider", "--max-context-kb", "--max-files", "--max-lines"]);
const PROFILES = {
  agent: { name: "ai:agent", maxIterations: 4, timeout: "45m", maxContextKb: 24 },
  overnight: { name: "ai:overnight", maxIterations: DEFAULTS.maxIterations, timeout: "6h", maxContextKb: 60 },
};

export async function main(argv, profileName = "agent") {
  try { return await run(argv, profileName); }
  catch { console.error(WITHHELD); return 1; }
}

async function run(argv, profileName) {
  const P = PROFILES[profileName];
  const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
  const all = (n) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []));
  const flag = (n) => argv.includes(n);
  const positional = argv.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(argv[i - 1] ?? ""));
  const taskFile = val("--task-file");
  const TASK = val("--task") ?? (taskFile ? readFileSync(path.resolve(taskFile), "utf8").replace(/^﻿/, "").trim() : positional);

  if (flag("--help") || !TASK) {
    console.log(`WOS AI Agent - ${P.name} (DEV only; never stages, commits, pushes or deploys)
  ${P.name === "ai:agent" ? 'npm run ai:agent -- "describe the bug or goal"' : 'npm run ai:overnight -- --task "..." --timeout 6h'}
  --task <text> | --task-file <utf8.txt>   the job (use --task-file for Thai text in PowerShell)
  --max-iterations <n>   default ${P.maxIterations}      --timeout <6h|45m|90s>   default ${P.timeout}
  --failure-limit <n>    consecutive errored iterations before BLOCKED (default ${DEFAULTS.failureLimit})
  --no-improve-limit <n> iterations without fewer failures before BLOCKED (default ${DEFAULTS.noImproveLimit})
  --scope <glob>         writable DEV scope, repeatable (default ${DEFAULT_WRITE_SCOPE.join(", ")})
  --file <path>          extra file to show the model, repeatable
  --focus                show the model ONLY --file files + files named in failing tests (small prompt for slow/local models)
  --max-context-kb <n>   cap on source sent per model call (default ${P.maxContextKb})
  --model <name>         LiteLLM model (default: WOS_AI_AGENT_MODEL / LITELLM_MODEL)
  --provider <name>      LLM provider: litellm or claude (default: WOS_AI_AGENT_PROVIDER / litellm)
  --base-url <url>       dev server for ai-regression-test.mjs
  --build                also require 'npm run build' to pass
  --skip-regression      do not require ai-regression-test.mjs (reported as skipped, never as passed)
  --max-files <n> --max-lines <n>   size limit of an acceptable patch (default 3 files, 80 lines)
  --no-reproduce         do not write a failing test first when the baseline is green
  --no-contract          turn off layer / hard-code / Definition-of-Done enforcement
  --allow-test-edits     let the agent modify existing tests (off by default)
  --notify               send the final status via scripts/telegram-notify.mjs`);
    return TASK ? 0 : 1;
  }

  if (!process.env.LITELLM_API_KEY && !process.env.OPENAI_API_KEY) {
    try { (await import("dotenv")).config({ path: path.resolve(".env.local"), quiet: true }); } catch { /* optional */ }
  }

  const guard = createGuard({ writeScope: all("--scope").length ? all("--scope") : DEFAULT_WRITE_SCOPE, allowTestEdits: flag("--allow-test-edits"), npmScripts: flag("--build") ? ["build"] : [] });
  const branch = guard.exec("git", ["branch", "--show-current"]).output.trim();
  if (!branch) { console.error("Not a git repository (or detached HEAD). Refusing to run: the diff is the safety net."); return 1; }
  if (["main", "master"].includes(branch) && !flag("--allow-main-branch")) { console.error(`Refusing to run on '${branch}'. Create a work branch first (git switch -c ai/agent-<date>).`); return 1; }

  const contract = !flag("--no-contract");
  const { makeLlm } = await import("./llm.mjs");
  const provider = val("--provider", process.env.WOS_AI_AGENT_PROVIDER || "litellm").toLowerCase();
  if (!["litellm", "claude"].includes(provider)) {
    console.error("Unsupported AI agent provider. Use litellm or claude.");
    return 1;
  }
  const ask = provider === "claude"
    ? (await import("./claude-exec.mjs")).makeClaudeAsk()
    : undefined;
  const llm = makeLlm({ guard, extraFiles: all("--file"), model: val("--model"), ask, focus: flag("--focus"), maxContextKb: Number(val("--max-context-kb", P.maxContextKb)), contract });
  const artifactsDir = path.resolve(".overnight", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(artifactsDir, { recursive: true });

  const result = await supervise({
    task: TASK, guard, gate: runGate, ...llm, artifactsDir,
    log: (m) => console.log(`[${P.name} ${new Date().toISOString().slice(11, 19)}] ${m}`),
    opts: {
      maxIterations: Number(val("--max-iterations", P.maxIterations)),
      timeoutMs: parseDuration(val("--timeout"), parseDuration(P.timeout)),
      failureLimit: Number(val("--failure-limit", DEFAULTS.failureLimit)),
      noImproveLimit: Number(val("--no-improve-limit", DEFAULTS.noImproveLimit)),
      contract, reproduce: contract && !flag("--no-reproduce"),
      maxFiles: Number(val("--max-files", DEFAULTS.maxFiles)), maxLines: Number(val("--max-lines", DEFAULTS.maxLines)),
      gate: { skipRegression: flag("--skip-regression"), build: flag("--build"), baseUrl: val("--base-url", process.env.WOS_TEST_BASE_URL) },
    },
  });

  publishRun(result, { artifactsDir, profileName: P.name,
    notify: flag("--notify") ? (message) => guard.exec("node", ["scripts/telegram-notify.mjs", message]) : undefined,
  });
  return { PASS: 0, BLOCKED: 2, TIMEOUT: 3 }[result.status] ?? 2;
}

export function publishRun(result, { artifactsDir, profileName, log = console.log, notify }) {
  const report = redact(formatReport(result));
  writeFileSync(path.join(artifactsDir, "report.md"), report + "\n", { flag: "wx" });
  writeFileSync(path.join(artifactsDir, "report.json"), safeJson({ ...result, diff: undefined }), { flag: "wx" });
  const patchAvailable = !result.diffWithheld && inspectText(result.diff).safe;
  if (patchAvailable) writeFileSync(path.join(artifactsDir, "changes.patch"), result.diff, { flag: "wx" });
  const rel = redact(path.relative(process.cwd(), artifactsDir));
  log(redact("\n" + report + "\n\nArtifacts: " + rel + "/"));
  if (result.awaitingApproval && patchAvailable) log("Review the artifacts before approving the change.");
  if (notify) notify(redact([
    "WOS " + profileName, report.split("\n")[0], "Task: " + result.task,
    "Iterations: " + result.iterationCount, "Commit/Push/Deploy: NONE",
  ].join("\n")));
}
