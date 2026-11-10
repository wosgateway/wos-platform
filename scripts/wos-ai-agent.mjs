#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";

// Load local development env for agent notifications without printing secrets.
if (!process.env.WOS_AI_AGENT_TELEGRAM_BOT_TOKEN || !process.env.WOS_AI_AGENT_TELEGRAM_CHAT_ID) {
  try {
    const { config } = await import("dotenv");
    const { fileURLToPath } = await import("node:url");
    const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
    config({ path: envPath, quiet: true });
  } catch {
    // Keep explicitly exported environment variables working if dotenv is unavailable.
  }
}

const ROOT = process.cwd();
const args = process.argv.slice(2);

function arg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name) {
  return args.includes(name);
}

function run(command, commandArgs = []) {
  const executable = process.platform === "win32" && command === "npm.cmd"
    ? "cmd.exe"
    : command;
  const executableArgs = process.platform === "win32" && command === "npm.cmd"
    ? ["/d", "/s", "/c", `npm.cmd ${commandArgs.join(" ")}`]
    : commandArgs;

  try {
    const output = execFileSync(executable, executableArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { ok: true, output, exitCode: 0 };
  } catch (error) {
    return {
      ok: false,
      output: error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message,
      exitCode: error.status ?? 1,
    };
  }
}

function notify(message) {
  const botToken =
    process.env.WOS_AI_AGENT_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId =
    process.env.WOS_AI_AGENT_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  const source =
    process.env.WOS_AI_AGENT_TELEGRAM_BOT_TOKEN && process.env.WOS_AI_AGENT_TELEGRAM_CHAT_ID
      ? 'WOS_AI_AGENT_TELEGRAM_*'
      : process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
        ? 'TELEGRAM_*'
        : 'none';
  console.log(`[WOS_AI_AGENT] Telegram env source=${source}`);
  if (!botToken || !chatId) return;
  try {
    execFileSync(
      "node",
      ["scripts/telegram-notify.mjs", message],
      {
        cwd: ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          TELEGRAM_BOT_TOKEN: botToken,
          TELEGRAM_CHAT_ID: chatId,
        },
      }
    );
  } catch {
    console.error("Telegram notification failed.");
  }
}

function fail(message, notifyMessage = message) {
  console.error(message);
  notify(`WOS AI Dev Agent\n\nFAIL\n${notifyMessage}`);
  process.exit(1);
}

function safePath(relativePath) {
  if (!relativePath) fail("Missing --file.");
  const normalized = path.normalize(relativePath);
  const absolute = path.resolve(ROOT, normalized);
  const root = realpathSync(ROOT);
  if (!absolute.startsWith(root + path.sep)) {
    fail("EDIT_DEV blocked: file is outside repository.");
  }
  if (/(^|[\\/])(?:\.git|node_modules)(?:[\\/]|$)/i.test(normalized)) {
    fail("EDIT_DEV blocked: protected directory.");
  }
  if (/(^|[\\/])\.env(?:\.|$)/i.test(normalized)) {
    fail("EDIT_DEV blocked: environment/secret file.");
  }
  if (/production|prod(?:uction)?[-_]?config/i.test(normalized)) {
    fail("EDIT_DEV blocked: production-related path.");
  }
  const allowed = /\.(?:js|mjs|cjs|ts|tsx|json|md|ps1|yml|yaml|css)$/i.test(normalized);
  if (!allowed) fail("EDIT_DEV blocked: file type is not allowlisted.");
  return absolute;
}

function containsSecretPattern(value) {
  return /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|NOTION_TOKEN|NOTION_API_KEY/i.test(value);
}

function agentEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  return value.replace(/^"([\s\S]*)"$/, "$1").replace(/^'([\s\S]*)'$/, "$1");
}

let agentLlmClient = null;

function getAgentLlmClient() {
  if (!agentLlmClient) {
    const baseURL = agentEnv("LITELLM_BASE_URL");
    const apiKey = agentEnv("LITELLM_API_KEY") || agentEnv("OPENAI_API_KEY");
    if (!apiKey) fail("AI_PLAN blocked: LITELLM_API_KEY/OPENAI_API_KEY is not configured.");

    agentLlmClient = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      maxRetries: 0,
    });
  }
  return agentLlmClient;
}

function parseAgentJson(content) {
  const text = String(content || "").trim();
  if (!text) fail("AI_PLAN stopped: LLM returned an empty response.");

  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // Continue to the final structured-response failure below.
      }
    }
  }

  fail("AI_PLAN stopped: LLM response was not valid JSON.");
}

function validateAiPlanQuality(task, plan, sourceContexts) {
  const normalizedTask = String(task || "").toLowerCase();

  const conciergeHotelHandoff =
    /(concierge|hotel|handoff)/i.test(normalizedTask);

  if (!conciergeHotelHandoff) return;

  const requiredAnchors = [
    "src/lib/ai/core.ts",
    "src/lib/ai/concierge-flow.ts",
    "src/app/api/chatwoot/webhook/route.ts",
    "src/lib/handoff/concierge.ts",
  ];

  const inspected = new Set(
    plan.filesToInspect.map((file) => String(file).replace(/\\/g, "/")),
  );

  const missingAnchors = requiredAnchors.filter(
    (file) => !inspected.has(file),
  );

  if (missingAnchors.length) {
    fail(
      "AI_PLAN quality gate failed: concierge hotel handoff plan omitted required execution-path files.\n" +
        missingAnchors.map((file) => `- ${file}`).join("\n"),
    );
  }

  const contextFiles = new Set(
    sourceContexts.map((item) => String(item.file).replace(/\\/g, "/")),
  );

  const missingContext = requiredAnchors.filter(
    (file) => !contextFiles.has(file),
  );

  if (missingContext.length) {
    fail(
      "AI_PLAN quality gate failed: required execution-path source context was not supplied.\n" +
        missingContext.map((file) => `- ${file}`).join("\n"),
    );
  }

  const rootCause = String(plan.rootCause || "").trim().toLowerCase();

  const evidenceSymbols = [
    "pendingquestion",
    "answeredquestion",
    "hotelneeded",
    "decideconciergereply",
    "ishandoffconfirmation",
    "submithandoff",
    "ask_hotel_interest",
    "buildhandoffconfirmation",
    "buildconciergehandoff",
  ];

  const rootCauseHasEvidence = evidenceSymbols.some((symbol) =>
    rootCause.includes(symbol),
  );

  if (!rootCauseHasEvidence) {
    fail(
      "AI_PLAN quality gate failed: rootCause must identify at least one concrete state, symbol, condition, or transition from the supplied execution-path evidence.",
    );
  }

  const genericRootCausePatterns = [
    "does not prevent repeated hotel prompts",
    "doesn't prevent repeated hotel prompts",
    "repeated hotel prompts after hotel handoff",
    "does not handle repeated hotel prompts",
    "doesn't handle repeated hotel prompts",
    "is not handling the customer's response correctly",
    "does not handle the customer's response correctly",
    "doesn't handle the customer's response correctly",
  ];

  if (
    rootCause.length < 80 ||
    genericRootCausePatterns.some((pattern) => rootCause === pattern)
  ) {
    fail(
      "AI_PLAN quality gate failed: rootCause is too generic and does not identify a supported mechanism/state/condition.",
    );
  }

  const proposedChanges = plan.proposedChanges
    .map((change) => String(change).trim())
    .join(" ")
    .toLowerCase();

  const proposedChangesHasEvidence = evidenceSymbols.some((symbol) =>
    proposedChanges.includes(symbol),
  );

  if (!proposedChangesHasEvidence) {
    fail(
      "AI_PLAN quality gate failed: proposedChanges must identify at least one concrete state, symbol, condition, or transition to change.",
    );
  }

  if (
    proposedChanges.length < 80 ||
    /modify (the )?(ai core|concierge flow).*prevent repeated hotel prompts/i.test(
      proposedChanges,
    )
  ) {
    fail(
      "AI_PLAN quality gate failed: proposedChanges are too generic; identify the concrete state/condition/transition to change.",
    );
  }

  const validation = plan.validation
    .map((command) => String(command).trim())
    .filter(Boolean);

  const commandLike = validation.some(
    (item) =>
      /^(npm|npx|node|pnpm|yarn|powershell|pwsh|git)\b/i.test(item) ||
      /\.(?:mjs|js|ps1|ts|tsx)\b/i.test(item),
  );

  if (!commandLike) {
    fail(
      "AI_PLAN quality gate failed: validation must contain at least one executable repository validation command.",
    );
  }
}

function repoFileList() {
  const result = run("git", ["ls-files"]);
  if (!result.ok) {
    fail(`AI_PLAN stopped: unable to read repository file list.\n${result.output}`);
  }

  return result.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !/(^|[\\/])(?:\.git|node_modules)(?:[\\/]|$)/i.test(file))
    .slice(0, 5000);
}

function repoRelevantFiles(task, limit = 30) {
  const result = run("node", [
    "scripts/wos-ai-agent-repo.mjs",
    "--query",
    task,
    "--limit",
    String(limit),
    "--json",
  ]);

  if (!result.ok) {
    fail(
      `AI_PLAN stopped: repository intelligence failed.\n${result.output}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(result.output);
  } catch {
    fail("AI_PLAN stopped: repository intelligence returned invalid JSON.");
  }

  if (!Array.isArray(parsed.matches)) {
    fail("AI_PLAN stopped: repository intelligence returned no matches array.");
  }

  const priorityFiles = new Map([
    ["src/lib/ai/core.ts", 12],
    ["src/lib/ai/concierge-flow.ts", 12],
    ["src/lib/ai/concierge-flow.test.ts", 11],
    ["src/app/api/chatwoot/webhook/route.ts", 11],
    ["src/lib/handoff/concierge.ts", 10],
    ["src/lib/handoff/concierge.test.ts", 10],
    ["ai-transport-hotel-regression-test.mjs", 9],
  ]);

  return parsed.matches
    .filter((item) => item && typeof item.file === "string")
    .map((item) => {
      const file = item.file.replace(/\\/g, "/");
      const retrievalScore = Number(item.score) || 0;
      const priorityBoost = priorityFiles.get(file) || 0;

      return {
        file,
        score: retrievalScore + priorityBoost,
        retrievalScore,
        priorityBoost,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.retrievalScore - a.retrievalScore ||
        a.file.localeCompare(b.file),
    );
}

function planningMatches(task, matches, limit = 15) {
  const normalizedTask = String(task || "").toLowerCase();

  const conciergeHotelHandoff =
    /(concierge|hotel|handoff)/i.test(normalizedTask);

  if (!conciergeHotelHandoff) {
    return matches.slice(0, limit);
  }

  const anchorFiles = [
    "src/lib/ai/core.ts",
    "src/lib/ai/concierge-flow.ts",
    "src/app/api/chatwoot/webhook/route.ts",
    "src/lib/handoff/concierge.ts",
  ];

  const byFile = new Map(
    matches.map((item) => [String(item.file).replace(/\\/g, "/"), item]),
  );

  const selected = [];

  for (const file of anchorFiles) {
    const existing = byFile.get(file);

    if (existing) {
      selected.push(existing);
      continue;
    }

    const absolute = path.resolve(ROOT, file);

    if (!existsSync(absolute)) {
      fail(`AI_PLAN stopped: required planning anchor is missing: ${file}`);
    }

    selected.push({
      file,
      score: 0,
      retrievalScore: 0,
      priorityBoost: 0,
      planningAnchor: true,
    });
  }

  for (const match of matches) {
    const normalized = String(match.file).replace(/\\/g, "/");

    if (!anchorFiles.includes(normalized)) {
      selected.push(match);
    }

    if (selected.length >= limit) break;
  }

  return selected.slice(0, limit);
}

function repoSourceContext(matches, maxFiles = 8, maxBytesPerFile = 24 * 1024) {
  const contexts = [];

  for (const match of matches.slice(0, maxFiles)) {
    const normalized = path.normalize(String(match.file));
    const absolute = path.resolve(ROOT, normalized);

    if (
      !absolute.startsWith(ROOT + path.sep) ||
      /(^|[\\/])(?:\.git|node_modules)(?:[\\/]|$)/i.test(normalized) ||
      /(^|[\\/])\.env(?:\.|$)/i.test(normalized)
    ) {
      continue;
    }

    if (!existsSync(absolute)) continue;

    let source;
    try {
      source = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }

    if (containsSecretPattern(source)) {
      continue;
    }

    const bytes = Buffer.byteLength(source, "utf8");
    const bounded =
      bytes > maxBytesPerFile
        ? `${source.slice(0, maxBytesPerFile)}\n[TRUNCATED: source context limit reached]`
        : source;

    contexts.push({
      file: normalized,
      score: Number(match.score) || 0,
      source: bounded,
    });
  }

  return contexts;
}

function buildExecutionPathEvidence(task) {
  const normalizedTask = String(task || "").toLowerCase();

  const conciergeHotelHandoff =
    /(concierge|hotel|handoff)/i.test(normalizedTask);

  if (!conciergeHotelHandoff) return "";

  const executionPath = [
    {
      file: "src/app/api/chatwoot/webhook/route.ts",
      symbols: ["isHandoffConfirmation", "submitHandoff"],
    },
    {
      file: "src/lib/ai/core.ts",
      symbols: [
        "pendingQuestion",
        "answeredQuestion",
        "hotelNeeded",
        "decideConciergeReply",
        "buildConciergeHandoff",
      ],
    },
    {
      file: "src/lib/ai/concierge-flow.ts",
      symbols: [
        "decideConciergeReply",
        "answeredQuestion",
        "ask_hotel_interest",
        "buildHandoffConfirmation",
        "buildConciergeHandoff",
      ],
    },
    {
      file: "src/lib/handoff/concierge.ts",
      symbols: [
        "isHandoffConfirmation",
        "hotelNeeded",
        "buildConciergeHandoff",
        "buildHandoffConfirmation",
      ],
    },
  ];

  const lines = ["EXECUTION-PATH EVIDENCE"];

  for (const entry of executionPath) {
    const absolute = safePath(entry.file);
    let source = "";

    try {
      source = readFileSync(absolute, "utf8");
    } catch {
      lines.push(entry.file);
      lines.push("  read: FAILED");
      continue;
    }

    if (containsSecretPattern(source)) {
      lines.push(entry.file);
      lines.push("  read: BLOCKED_SECRET_PATTERN");
      continue;
    }

    const found = entry.symbols.filter((symbol) => source.includes(symbol));

    lines.push(entry.file);
    lines.push(
      found.length
        ? "  symbols: " + found.join(", ")
        : "  symbols: none found",
    );
  }

  return lines.join("\n");
}
async function aiPlan() {
  const task = arg("--task");
  if (!task?.trim()) fail("AI_PLAN requires --task.");

  if (containsSecretPattern(task)) {
    fail("AI_PLAN blocked: task contains a protected secret pattern.");
  }

  const system = [
    "You are the planning brain of the WOS AI Dev Agent.",
    "You analyze software-development problems in a local Next.js repository.",
    "You are READ-ONLY in this mode.",
    "Do not propose git add, commit, push, deploy, rollback, or production changes.",
    "Prefer the smallest safe DEV-only change.",
    "Separate root cause from symptoms.",
    "Trace the execution path across modules before selecting files to inspect.",
    "For concierge, hotel, and handoff tasks, follow the state/transition from inbound message through core orchestration, concierge decision logic, and handoff confirmation/submission.",
    "Do not select only the function that appears closest to the symptom when the behavior crosses module boundaries.",
    "Every file that owns, mutates, consumes, or gates the relevant state/transition must be included in filesToInspect.",
    "The rootCause must identify a concrete mechanism, state, condition, or transition supported by the supplied source evidence.",
    "Each proposedChange must name the relevant function/state/condition and describe the smallest safe DEV-only change.",
    "Each validation item must be an executable repository command, not a generic statement such as 'check for regressions'.",
    "Return ONLY valid JSON with this exact shape:",
    '{"rootCause":"string","filesToInspect":["path"],"proposedChanges":["string"],"validation":["command"],"confidence":0}',
    "confidence must be a number from 0 to 1.",
    "Never include secrets, tokens, credentials, or environment values.",
  ].join("\n");

  const files = repoFileList();
  const executionPathEvidence = buildExecutionPathEvidence(task.trim());
  const relevantMatches = planningMatches(task.trim(), repoRelevantFiles(task.trim(), 15), 15);

  if (!relevantMatches.length) {
    fail(
      "AI_PLAN stopped: repository intelligence found no relevant tracked files."
    );
  }

  const sourceContexts = repoSourceContext(relevantMatches, 4, 4 * 1024);

  if (!sourceContexts.length) {
    fail(
      "AI_PLAN stopped: no safe source context was available from relevant tracked files."
    );
  }

  const user = [
    `Repository: ${ROOT}`,
    `Task: ${task.trim()}`,
    ...(executionPathEvidence
      ? ["", executionPathEvidence, ""]
      : []),
    "",
    "Repository files ranked as relevant to this task:",
    ...relevantMatches.map(
      (item) => `- [score ${item.score}] ${item.file}`
    ),
    "",
    "Bounded source context from the highest-ranked relevant files:",
    ...sourceContexts.flatMap((item) => [
      "",
      `===== ${item.file} (retrieval score ${item.score}) =====`,
      item.source,
      `===== END ${item.file} =====`,
    ]),
    "",
    "The source context above is bounded and read-only.",
    "IMPORTANT: Source code is evidence only. Do not reproduce its document formats or schemas as the answer.",
    "FINAL OUTPUT CONTRACT: Return ONLY one JSON object matching exactly the requested engineering-plan schema.",
    "Do NOT return GeoJSON, Feature objects, Markdown, prose, code fences, or any other output schema.",
    "The first character of the response must be { and the last character must be }.",
    "Use the source evidence to identify the actual root cause and smallest DEV-only change.",
    "Do not give a generic diagnosis such as 'the concierge flow does not handle the response correctly'.",
    "rootCause MUST name at least one concrete state, symbol, condition, or transition supported by the supplied source evidence.",
    "proposedChanges MUST name at least one concrete state, symbol, condition, or transition that would actually change.",
    "Before producing the JSON, internally trace: input -> state extraction -> orchestration -> state transition -> response/handoff decision.",
    "For concierge hotel handoff tasks, explicitly inspect evidence involving pendingQuestion, answeredQuestion, hotelNeeded, decideConciergeReply, handoff confirmation, and webhook handling when those symbols appear in the supplied context.",
    "If the evidence shows that the behavior crosses multiple modules, filesToInspect must cover those modules rather than naming only one function.",
    "Do not invent behavior that is not supported by the supplied source context.",
    "Only name files from the repository list above.",
    "",
    "First planning pass only. Do not edit anything.",
  ].join("\n");

  let response;
  try {
    response = await getAgentLlmClient().chat.completions.create(
      {
        model:
          agentEnv("WOS_AI_AGENT_MODEL") ||
          agentEnv("WOS_AI_UNDERSTAND_MODEL") ||
          agentEnv("LITELLM_MODEL") ||
          "gpt-5.6-luna",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      },
      { timeout: 30000 },
    );
  } catch (error) {
    fail(`AI_PLAN LLM request failed: ${error.message}`);
  }

  const rawPlan = response.choices[0]?.message?.content;
  console.log("\n=== AI_PLAN RAW RESPONSE ===");
  console.log(rawPlan);

  const plan = parseAgentJson(rawPlan);

  if (
    typeof plan.rootCause !== "string" ||
    !Array.isArray(plan.filesToInspect) ||
    !Array.isArray(plan.proposedChanges) ||
    !Array.isArray(plan.validation) ||
    typeof plan.confidence !== "number"
  ) {
    fail("AI_PLAN stopped: LLM returned an invalid plan schema.");
  }

  const conciergeHotelHandoff = /(concierge|hotel|handoff)/i.test(task.trim().toLowerCase());

  if (conciergeHotelHandoff) {
    const requiredExecutionPath = [
      "src/lib/ai/core.ts",
      "src/lib/ai/concierge-flow.ts",
      "src/app/api/chatwoot/webhook/route.ts",
      "src/lib/handoff/concierge.ts",
    ];

    const existing = new Set(
      plan.filesToInspect.map((file) => String(file).replace(/\\/g, "/")),
    );

    for (const file of requiredExecutionPath) {
      if (existsSync(safePath(file)) && !existing.has(file)) {
        plan.filesToInspect.push(file);
      }
    }
  }

  if (plan.filesToInspect.some((file) => containsSecretPattern(String(file)))) {
    fail("AI_PLAN blocked: plan contains protected secret patterns.");
  }

  const existingFiles = new Set(repoFileList().map((file) => path.normalize(file)));

  validateAiPlanQuality(task.trim(), plan, sourceContexts);
  const unknownFiles = plan.filesToInspect.filter(
    (file) => !existingFiles.has(path.normalize(String(file)))
  );

  if (unknownFiles.length > 0) {
    fail(
      `AI_PLAN stopped: LLM proposed files that do not exist in the repository.\n- ${unknownFiles.join("\n- ")}`
    );
  }

  console.log("\n=== WOS AI DEV AGENT / AI PLAN ===");
  console.log(`TASK: ${task.trim()}`);
  console.log(`\nROOT CAUSE:\n${plan.rootCause}`);

  console.log("\nFILES TO INSPECT:");
  for (const file of plan.filesToInspect) {
    console.log(`- ${file}`);
  }

  console.log("\nPROPOSED CHANGES:");
  for (const change of plan.proposedChanges) {
    console.log(`- ${change}`);
  }

  console.log("\nVALIDATION:");
  for (const command of plan.validation) {
    console.log(`- ${command}`);
  }

  console.log(`\nCONFIDENCE: ${Math.round(plan.confidence * 100)}%`);
  console.log("\nAI_PLAN STOP: read-only; no files changed; no git/production action.");
}

function editDev() {
  const file = safePath(arg("--file"));
  const oldText = arg("--old");
  const newText = arg("--new");

  if (oldText === undefined || newText === undefined) {
    fail("EDIT_DEV requires --file, --old and --new.");
  }
  if (!existsSync(file)) fail("EDIT_DEV blocked: target file does not exist.");
  if (containsSecretPattern(oldText) || containsSecretPattern(newText)) {
    fail("EDIT_DEV blocked: secret-related content detected.");
  }

  const before = readFileSync(file, "utf8");
  if (!before.includes(oldText)) fail("EDIT_DEV stopped: target text was not found.");
  const occurrences = before.split(oldText).length - 1;
  if (occurrences !== 1) fail(`EDIT_DEV stopped: expected 1 match, found ${occurrences}.`);

  const after = before.replace(oldText, newText);

  writeFileSync(file, after, "utf8");
  console.log(`EDIT_DEV PASS: ${path.relative(ROOT, file)}`);
  console.log("No commit, push, or deploy performed.");
  notify(`WOS AI Dev Agent\n\nEDIT_DEV PASS\nFile: ${path.relative(ROOT, file)}\nNo commit/push/deploy`);
}

function plan() {
  const task = arg("--task");
  if (!task) fail("PLAN requires --task.");
  const branchResult = run("git", ["branch", "--show-current"]);
  const statusResult = run("git", ["status", "--short"]);
  if (!branchResult.ok || !statusResult.ok) fail("PLAN stopped: unable to inspect repository state.");
  console.log("WOS AI Dev Agent Plan");
  console.log("");
  console.log(`Task: ${task}`);
  console.log(`Branch: ${branchResult.output}`);
  console.log("");
  console.log("Plan:");
  console.log("1. Inspect repository and current working tree");
  console.log("2. Identify the smallest DEV-only change set");
  console.log("3. Apply only explicit EDIT_DEV changes");
  console.log("4. Run validation and AI regression");
  console.log("5. Stop for human approval before commit/push/deploy");
  console.log("");
  console.log(`Working tree: ${statusResult.output || "clean"}`);
  console.log("Protected: .env, secrets, .git, node_modules, production paths");
  console.log("PLAN ONLY: no files changed; no commit/push/deploy performed.");
  notify(`WOS AI Dev Agent\n\nPLAN\nTask: ${task}\nNo files changed`);
}

function verifyChange() {
  const statusResult = run("git", ["status", "--short"]);
  const diffCheck = run("git", ["diff", "--check"]);
  const changed = run("git", ["diff", "--name-only"]);
  const staged = run("git", ["diff", "--cached", "--name-only"]);
  if (!statusResult.ok || !diffCheck.ok || !changed.ok || !staged.ok) fail("VERIFY_CHANGE stopped: unable to inspect git state.");
  const names = `${changed.output}\n${staged.output}`.trim();
  const protectedPath = names.split(/\r?\n/).filter(Boolean).find((name) => /(^|[\\/])(?:\.env(?:\.|$)|\.git(?:[\\/]|$)|node_modules(?:[\\/]|$)|production|prod(?:uction)?[-_]?config)/i.test(name));
  if (protectedPath) fail(`VERIFY_CHANGE blocked protected path: ${protectedPath}`);
  console.log("WOS AI Dev Agent Change Verification");
  console.log("");
  console.log(`Git diff check: ${diffCheck.ok ? "PASS" : "FAIL"}`);
  console.log(`Changed files: ${names || "none"}`);
  console.log("Secret values are not printed.");
  console.log("No commit, push, or deploy performed.");
  if (!names) {
    console.log("VERIFY_CHANGE PASS: no changes to validate.");
    return;
  }
  console.log("VERIFY_CHANGE PASS: change set is within repository safety boundaries.");
  notify(`WOS AI Dev Agent\n\nVERIFY_CHANGE PASS\nChanged files: ${names.split(/\\r?\n/).filter(Boolean).length}\nNo commit/push/deploy`);
}

function runTests() {
  notify("WOS AI Dev Agent\n\nRUN_TESTS started\nRunning preflight + AI regression");
  const preflight = run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ".\\preflight-build.ps1",
    "-SkipBuild",
  ]);
  if (!preflight.ok) {
    fail(`Preflight failed (exit ${preflight.exitCode}).\n${preflight.output}`, "Preflight failed. No commit/push/deploy.");
  }

  const regressionArgs = ["node", ".\\ai-regression-test.mjs"];
  const regressionBaseUrl = arg("--base-url") || process.env.WOS_TEST_BASE_URL;
  if (regressionBaseUrl) regressionArgs.push("--base-url", regressionBaseUrl);
  const regression = run("node", regressionArgs);
  if (!regression.ok) {
    fail(`AI regression failed (exit ${regression.exitCode}).\n${regression.output}`, "AI regression failed. No commit/push/deploy.");
  }

  console.log("RUN_TESTS PASS");
  console.log("Preflight and AI regression completed.");
  notify("WOS AI Dev Agent\n\nRUN_TESTS PASS\nPreflight + AI regression completed\nHuman approval still required for commit/push/deploy");
}

function repoIntelligence() {
  const query = arg("--query");
  const limit = arg("--limit");
  const childArgs = ["scripts/wos-ai-agent-repo.mjs"];
  if (query) childArgs.push("--query", query);
  if (limit) childArgs.push("--limit", limit);
  if (hasFlag("--json")) childArgs.push("--json");
  const result = run("node", childArgs);
  if (!result.ok) fail("Repository intelligence failed.\n" + result.output, "Repository intelligence failed. No changes performed.");
  console.log(result.output);
  notify("WOS AI Dev Agent\n\nREPOSITORY_INTELLIGENCE PASS\nRead-only repository mapping completed\nNo changes performed");
}

function operationalStatus() {
  const includeRegression = hasFlag("--include-regression");
  notify(`WOS AI Dev Agent\n\nOPERATIONAL_STATUS started\nRead-only system and production audit`);
  const status = run("npm.cmd", [
    "run",
    "ai:dev-agent:status",
    ...(includeRegression ? ["--", "--include-regression"] : []),
  ]);
  if (!status.ok) {
    fail(
      "Operational status requires review.\n" + status.output,
      "Operational status requires review. No changes were performed."
    );
  }
  console.log(status.output);
  console.log("OPERATIONAL_STATUS PASS");
  console.log("Read-only: no files, Git history, or Production state changed.");
  notify(`WOS AI Dev Agent\n\nOPERATIONAL_STATUS PASS\nRead-only audit completed\nNo changes performed`);
}

function auditHistory() {
  const limit = arg("--limit");
  const since = arg("--since");
  const json = hasFlag("--json");
  notify("WOS AI Dev Agent\n\nAUDIT_HISTORY started\nRead-only Git and Production history");
  const auditArgs = ["run", "ai:dev-agent:audit"];
  if (limit) auditArgs.push("--", "--limit", limit);
  if (since) auditArgs.push("--", "--since", since);
  if (json) auditArgs.push("--", "--json");
  const audit = run("npm.cmd", auditArgs);
  if (!audit.ok) {
    fail(
      "Audit/history requires review.\n" + audit.output,
      "Audit/history requires review. No changes were performed."
    );
  }
  console.log(audit.output);
  console.log("AUDIT_HISTORY PASS");
  console.log("Read-only: no files, Git history, or Production state changed.");
  notify("WOS AI Dev Agent\n\nAUDIT_HISTORY PASS\nGit and Production history reviewed\nNo changes performed");
}
function productionGate() {
  const skipBuild = hasFlag("--skip-build");
  notify(`WOS AI Dev Agent\n\nPRODUCTION_GATE started\nRunning production deployment gate${skipBuild ? " (build skipped)" : ""}`);
  const gate = run("npm.cmd", ["run", "production:gate", ...(skipBuild ? ["--", "--skip-build"] : [])]);
  if (!gate.ok) {
    fail(
      `Production Deployment Gate failed.\n${gate.output}`,
      "Production Deployment Gate failed. Deployment remains blocked."
    );
  }
  console.log(gate.output);
  console.log("PRODUCTION_GATE PASS");
  console.log("Deployment has NOT been performed.");
  console.log("Separate human approval is still required before deployment.");
  notify("WOS AI Dev Agent\n\nPRODUCTION_GATE PASS\nPreflight + AI regression + production target guard completed\nDeployment NOT performed\nHuman approval still required before deploy");
}

function requireTelegramApproval(action, details = "") {
  const approvalScript = path.join(
    ROOT,
    "scripts",
    "wos-ai-agent-telegram-approval.mjs"
  );

  const approval = run("node", [
    approvalScript,
    action,
    details || `WOS AI Dev Agent protected action: ${action}`,
  ]);

  if (!approval.ok) {
    fail(
      `Telegram approval was not granted for ${action}.`,
      `Telegram approval was not granted for ${action}. No protected action was performed.`
    );
  }

  console.log(`TELEGRAM_APPROVAL PASS: ${action}`);
  return approval;
}

function gitCommit() {
  const files = arg("--files");
  const message = arg("--message");

  if (!files) {
    fail(
      'GIT_COMMIT blocked: explicit --files "file1,file2" is required.'
    );
  }

  if (!message) {
    fail("GIT_COMMIT blocked: explicit --message is required.");
  }

  const explicitFiles = files
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (
    explicitFiles.length === 0 ||
    explicitFiles.some((item) => item === "." || item === "..")
  ) {
    fail("GIT_COMMIT blocked: invalid explicit file allowlist.");
  }

  const details = [
    `files=${explicitFiles.join(",")}`,
    `message=${message}`,
  ].join(" | ");

  requireTelegramApproval("COMMIT", details);

  const result = run("node", [
    path.join(ROOT, "scripts", "wos-ai-agent-git-gate.mjs"),
    "--mode",
    "commit",
    "--files",
    explicitFiles.join(","),
    "--message",
    message,
    "--approve-commit",
  ]);

  if (!result.ok) {
    fail(
      `Git commit failed or was blocked.\n${result.output}`,
      "Git commit failed or was blocked. No automatic retry performed."
    );
  }

  console.log(result.output);
  console.log("GIT_COMMIT PASS");
}

function gitPush() {
  requireTelegramApproval(
    "PUSH",
    "Push current branch through the existing WOS Git Gate."
  );

  const result = run("node", [
    path.join(ROOT, "scripts", "wos-ai-agent-git-gate.mjs"),
    "--mode",
    "push",
    "--approve-push",
  ]);

  if (!result.ok) {
    fail(
      `Git push failed or was blocked.\n${result.output}`,
      "Git push failed or was blocked. No automatic retry performed."
    );
  }

  console.log(result.output);
  console.log("GIT_PUSH PASS");
}

function productionRecoveryCheck() {
  notify("WOS AI Dev Agent\n\nPRODUCTION_RECOVERY_CHECK started\nRead-only rollback safety inspection");
  const check = run("npm.cmd", ["run", "production:rollback:check"]);
  if (!check.ok) {
    fail(
      "Production recovery check failed.\n" + check.output,
      "Rollback safety check failed. No rollback action was performed."
    );
  }

  console.log(check.output);
  console.log("PRODUCTION_RECOVERY_CHECK PASS");
  console.log("Read-only: no rollback performed.");
  notify("WOS AI Dev Agent\n\nPRODUCTION_RECOVERY_CHECK PASS\nOlder READY deployment candidate identified\nNo rollback performed");
}

function productionSmokeCheck() {
  notify("WOS AI Dev Agent\n\nPRODUCTION_SMOKE_CHECK started\nRead-only production post-deploy verification");
  const check = run("npm.cmd", ["run", "production:smoke:check"]);
  if (!check.ok) {
    fail(
      "Production smoke check failed.\n" + check.output,
      "Production post-deploy smoke check failed. No deployment or rollback was performed."
    );
  }

  console.log(check.output);
  console.log("PRODUCTION_SMOKE_CHECK PASS");
  console.log("Read-only: no deployment or rollback performed.");
  notify("WOS AI Dev Agent\n\nPRODUCTION_SMOKE_CHECK PASS\nProduction alias, READY state, HTTP 200, and HTML response verified\nNo deployment/rollback performed");
}

function productionRollback() {
  const target = arg("--deployment");

  if (!target) {
    fail(
      "PRODUCTION_ROLLBACK blocked: explicit --deployment <deployment-id-or-url> is required."
    );
  }

  requireTelegramApproval(
    "ROLLBACK",
    `deployment=${target}`
  );

  notify(
    "WOS AI Dev Agent\n\nPRODUCTION_ROLLBACK started\nTelegram approval accepted"
  );

  const rollback = run("npm.cmd", [
    "run",
    "production:rollback",
    "--",
    "--approve-rollback",
    "--deployment",
    target,
  ]);

  if (!rollback.ok) {
    fail(
      "Production rollback failed or was blocked.\n" + rollback.output,
      "Production rollback failed or was blocked. No automatic retry performed."
    );
  }

  console.log(rollback.output);
  console.log("PRODUCTION_ROLLBACK PASS");
  console.log("Rollback completed and target verification passed.");
  console.log("Run production-smoke-check before declaring recovery complete.");

  notify(
    "WOS AI Dev Agent\n\nPRODUCTION_ROLLBACK PASS\nExplicit Telegram approval accepted\nFollow-up smoke check required"
  );
}

function productionRecover() {
  const target = arg("--deployment");

  if (!target) {
    fail(
      "PRODUCTION_RECOVERY blocked: explicit --deployment <deployment-id-or-url> is required."
    );
  }

  requireTelegramApproval(
    "RECOVERY",
    `deployment=${target}`
  );

  notify(
    "WOS AI Dev Agent\n\nPRODUCTION_RECOVERY started\nTelegram approval accepted"
  );

  const recovery = run("npm.cmd", [
    "run",
    "production:recover",
    "--",
    "--approve-recovery",
    "--deployment",
    target,
  ]);

  if (!recovery.ok) {
    fail(
      "Production recovery failed or was blocked.\n" + recovery.output,
      "Production recovery failed or was blocked. No automatic retry performed."
    );
  }

  console.log(recovery.output);
  console.log("PRODUCTION_RECOVERY PASS");
  console.log("Rollback completed and post-recovery smoke check passed.");

  notify(
    "WOS AI Dev Agent\n\nPRODUCTION_RECOVERY PASS\nTelegram approval accepted\nPost-recovery smoke check passed"
  );
}

function approvalTest() {
  requireTelegramApproval(
    "APPROVAL_TEST",
    "Safe Telegram approval test. No Git, Vercel, database, or production action will be performed."
  );

  console.log("APPROVAL_TEST PASS");
  console.log("Telegram approval accepted.");
  console.log("No protected action was performed.");
}
function productionDeploy() {
  requireTelegramApproval(
    "DEPLOY",
    "Production deployment to the protected WOS production target."
  );

  notify(
    "WOS AI Dev Agent\n\nPRODUCTION_DEPLOY started\nTelegram approval accepted"
  );

  const deploy = run("npm.cmd", [
    "run",
    "production:deploy",
    "--",
    "--approve-deploy",
  ]);

  if (!deploy.ok) {
    fail(
      "Production deploy failed.\n" + deploy.output,
      "Production deployment failed or was blocked. Check the deployment gate and Vercel verification."
    );
  }

  console.log(deploy.output);
  console.log("PRODUCTION_DEPLOY PASS");
  console.log("Production deployment completed and verified.");

  notify(
    "WOS AI Dev Agent\n\nPRODUCTION_DEPLOY PASS\nProduction deployment completed and verified\nAlias: www.wos.asia"
  );
}

function readOnly() {
  const requiredFiles = [
    "package.json",
    "Dockerfile",
    "preflight-build.ps1",
    "ai-regression-test.mjs",
    "scripts/telegram-notify.mjs",
  ];
  const branchResult = run("git", ["branch", "--show-current"]);
  const commitResult = run("git", ["rev-parse", "--short", "HEAD"]);
  const statusResult = run("git", ["status", "--short"]);
  const nodeResult = run("node", ["--version"]);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmResult = run(npmCommand, ["--version"]);
  const diffResult = run("git", ["diff", "--check"]);

  const branch = branchResult.output;
  const commit = commitResult.output;
  const status = statusResult.output;
  const nodeVersion = nodeResult.output;
  const npmVersion = npmResult.output;
  const diffCheck = diffResult.output;
  const missingFiles = requiredFiles.filter((file) => !existsSync(file));
  const checks = {
    gitRepo: branchResult.ok,
    node: nodeResult.ok,
    npm: npmResult.ok,
    requiredFiles: missingFiles.length === 0,
    diffCheck: diffResult.ok,
  };
  const passed = Object.values(checks).every(Boolean);
  const report = [
    "WOS AI Dev Agent Report",
    "",
    "Mode: READ_ONLY",
    `Branch: ${branch}`,
    `Commit: ${commit}`,
    "",
    "Checks:",
    `- Git repository: ${checks.gitRepo ? "PASS" : "FAIL"}`,
    `- Node: ${checks.node ? "PASS" : "FAIL"}`,
    `- npm: ${checks.npm ? "PASS" : "FAIL"}`,
    `- Required files: ${checks.requiredFiles ? "PASS" : "FAIL"}`,
    `- Git diff check: ${checks.diffCheck ? "PASS" : "FAIL"}`,
    "",
    `Git status: ${status || "clean"}`,
    missingFiles.length ? `Missing: ${missingFiles.join(", ")}` : "",
    "",
    `Overall: ${passed ? "PASS" : "FAIL"}`,
    "Security: No secrets read or printed",
    "Production touched: NO",
    "Commit: NOT YET",
    "Push: NOT YET",
    "Deploy: NOT YET",
  ].filter(Boolean).join("\n");
  console.log(report);
  notify(`WOS AI Dev Agent\n\n${passed ? "PASS" : "FAIL"}\nMode: READ_ONLY\nBranch: ${branch}\nCommit: ${commit}`);
  process.exit(passed ? 0 : 1);
}

const mode = arg("--mode") || "read-only";

if (hasFlag("--help")) {
  console.log("Modes: read-only | plan | edit-dev | verify-change | run-tests | operational-status | repo-intelligence | audit-history | commit | push | production-gate | production-deploy | production-rollback | production-recovery-check | production-smoke-check | production-recover");
  console.log("PLAN: --mode plan --task <description>");
  console.log("EDIT_DEV: --mode edit-dev --file <path> --old <text> --new <text>");
  console.log("VERIFY_CHANGE: --mode verify-change");
  console.log("RUN_TESTS: --mode run-tests [--base-url <local-test-url>]");
  console.log("OPERATIONAL_STATUS: --mode operational-status [--include-regression]");
  console.log("REPOSITORY_INTELLIGENCE: --mode repo-intelligence [--query <task>] [--limit <n>] [--json]");
  console.log("AUDIT_HISTORY: --mode audit-history [--limit <n>] [--since <date>] [--json]");
  console.log("PRODUCTION_GATE: --mode production-gate [--skip-build]");
  console.log("GIT_COMMIT: --mode commit --files <file1,file2> --message <msg>");
  console.log("GIT_PUSH: --mode push");
  console.log("APPROVAL_TEST: --mode approval-test (Telegram approval required; no protected action)");
  console.log("PRODUCTION_DEPLOY: --mode production-deploy (Telegram approval required)");
  console.log("PRODUCTION_ROLLBACK: --mode production-rollback --deployment <id-or-url> (Telegram approval required)");
  console.log("PRODUCTION_RECOVERY_CHECK: --mode production-recovery-check");
  console.log("PRODUCTION_SMOKE_CHECK: --mode production-smoke-check");
  console.log("PRODUCTION_RECOVER: --mode production-recover --deployment <id-or-url> (Telegram approval required)");
  process.exit(0);
}

if (mode === "commit") gitCommit();
else if (mode === "push") gitPush();
else if (mode === "ai-plan") await aiPlan();
else if (mode === "repo-intelligence") repoIntelligence();
else if (mode === "edit-dev") editDev();
else if (mode === "operational-status") operationalStatus();
else if (mode === "audit-history") auditHistory();
else if (mode === "plan") plan();
else if (mode === "verify-change") verifyChange();
else if (mode === "run-tests") runTests();
else if (mode === "production-gate") productionGate();
else if (mode === "approval-test") approvalTest();
else if (mode === "production-deploy") productionDeploy();
else if (mode === "production-rollback") productionRollback();
else if (mode === "production-recover") productionRecover();
else if (mode === "production-recovery-check") productionRecoveryCheck();
else if (mode === "production-smoke-check") productionSmokeCheck();
else if (mode === "read-only") readOnly();
else fail(`Unknown mode: ${mode}`);
