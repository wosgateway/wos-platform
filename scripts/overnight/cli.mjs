// Shared CLI for `ai:agent` (interactive, one task) and `ai:overnight` (long run). Never commits, pushes or deploys.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGuard, DEFAULT_WRITE_SCOPE, parseDuration } from "./guard.mjs";
import { runGate } from "./gate.mjs";
import { supervise, formatReport, DEFAULTS } from "./supervisor.mjs";

const VALUE_FLAGS = new Set(["--task", "--task-file", "--max-iterations", "--timeout", "--failure-limit", "--no-improve-limit", "--scope", "--file", "--base-url", "--model", "--max-context-kb", "--max-files", "--max-lines"]);
const PROFILES = {
  agent: { name: "ai:agent", maxIterations: 4, timeout: "45m", maxContextKb: 24 },
  overnight: { name: "ai:overnight", maxIterations: DEFAULTS.maxIterations, timeout: "6h", maxContextKb: 60 },
};

export async function main(argv, profileName = "agent") {
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
  const llm = makeLlm({ guard, extraFiles: all("--file"), model: val("--model"), focus: flag("--focus"), maxContextKb: Number(val("--max-context-kb", P.maxContextKb)), contract });
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

  const report = formatReport(result);
  writeFileSync(path.join(artifactsDir, "report.md"), report + "\n");
  writeFileSync(path.join(artifactsDir, "report.json"), JSON.stringify({ ...result, diff: undefined }, null, 2));
  writeFileSync(path.join(artifactsDir, "changes.patch"), result.diff || "");
  const rel = path.relative(process.cwd(), artifactsDir);
  console.log(`\n${report}\n\nArtifacts: ${rel}/ (report.md, report.json, changes.patch, iteration-*.json)`);
  if (result.awaitingApproval) console.log(`To approve (Telegram approval + explicit file list, never 'git add .'):\n  npm run ai:agent:commit -- --message "<commit message>"`);
  if (flag("--notify")) guard.exec("node", ["scripts/telegram-notify.mjs", `WOS ${P.name}\n${report.split("\n")[0]}\nTask: ${result.task}\nIterations: ${result.iterationCount}\nCommit/Push/Deploy: NONE`]);
  return { PASS: 0, BLOCKED: 2, TIMEOUT: 3 }[result.status] ?? 2;
}
