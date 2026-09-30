#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import path from "node:path";

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
  notify(`WOS AI Dev Agent\n\n❌ FAIL\n${notifyMessage}`);
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
  notify(`WOS AI Dev Agent\n\n🟢 EDIT_DEV PASS\nFile: ${path.relative(ROOT, file)}\nNo commit/push/deploy`);
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
  notify(`WOS AI Dev Agent\n\nℹ️ PLAN\nTask: ${task}\nNo files changed`);
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
  notify(`WOS AI Dev Agent\n\n🟢 VERIFY_CHANGE PASS\nChanged files: ${names.split(/\\r?\\n/).filter(Boolean).length}\nNo commit/push/deploy`);
}

function runTests() {
  notify("WOS AI Dev Agent\n\n🔵 RUN_TESTS started\nRunning preflight + AI regression");
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

  const regressionBaseUrl = arg("--base-url") || process.env.WOS_TEST_BASE_URL || "http://127.0.0.1:3011";
  const regression = run("node", [".\\ai-regression-test.mjs", "--base-url", regressionBaseUrl]);
  if (!regression.ok) {
    fail(`AI regression failed (exit ${regression.exitCode}).\n${regression.output}`, "AI regression failed. No commit/push/deploy.");
  }

  console.log("RUN_TESTS PASS");
  console.log("Preflight and AI regression completed.");
  notify("WOS AI Dev Agent\n\n✅ RUN_TESTS PASS\nPreflight + AI regression completed\nHuman approval still required for commit/push/deploy");
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
  notify(`WOS AI Dev Agent\\n\\n🔵 PRODUCTION_GATE started\\nRunning production deployment gate${skipBuild ? " (build skipped)" : ""}`);
  const gate = run("npm.cmd", ["run", "production:gate", ...(skipBuild ? ["--", "--skip-build"] : [])]);
  if (!gate.ok) {
    fail(
      `Production Deployment Gate failed.\\n${gate.output}`,
      "Production Deployment Gate failed. Deployment remains blocked."
    );
  }
  console.log(gate.output);
  console.log("PRODUCTION_GATE PASS");
  console.log("Deployment has NOT been performed.");
  console.log("Separate human approval is still required before deployment.");
  notify("WOS AI Dev Agent\\n\\n✅ PRODUCTION_GATE PASS\\nPreflight + AI regression + production target guard completed\\nDeployment NOT performed\\nHuman approval still required before deploy");
}

function productionRecoveryCheck() {
  notify("WOS AI Dev Agent\n\n🟡 PRODUCTION_RECOVERY_CHECK started\nRead-only rollback safety inspection");
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
  notify("WOS AI Dev Agent\n\n✅ PRODUCTION_RECOVERY_CHECK PASS\nOlder READY deployment candidate identified\nNo rollback performed");
}

function productionSmokeCheck() {
  notify("WOS AI Dev Agent\\n\\n🟡 PRODUCTION_SMOKE_CHECK started\\nRead-only production post-deploy verification");
  const check = run("npm.cmd", ["run", "production:smoke:check"]);
  if (!check.ok) {
    fail(
      "Production smoke check failed.\\n" + check.output,
      "Production post-deploy smoke check failed. No deployment or rollback was performed."
    );
  }

  console.log(check.output);
  console.log("PRODUCTION_SMOKE_CHECK PASS");
  console.log("Read-only: no deployment or rollback performed.");
  notify("WOS AI Dev Agent\\n\\n✅ PRODUCTION_SMOKE_CHECK PASS\\nProduction alias, READY state, HTTP 200, and HTML response verified\\nNo deployment/rollback performed");
}

function productionRollback() {
  if (!hasFlag("--approve-rollback")) {
    fail("PRODUCTION_ROLLBACK blocked: explicit --approve-rollback approval is required.");
  }

  const target = arg("--deployment");
  if (!target) {
    fail("PRODUCTION_ROLLBACK blocked: explicit --deployment <deployment-id-or-url> is required.");
  }

  notify("WOS AI Dev Agent\\n\\n🔴 PRODUCTION_ROLLBACK started\\nExplicit human approval supplied");
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
      "Production rollback failed or was blocked.\\n" + rollback.output,
      "Production rollback failed or was blocked. No automatic retry performed."
    );
  }

  console.log(rollback.output);
  console.log("PRODUCTION_ROLLBACK PASS");
  console.log("Rollback completed and target verification passed.");
  console.log("Run production-smoke-check before declaring recovery complete.");
  notify("WOS AI Dev Agent\\n\\n✅ PRODUCTION_ROLLBACK PASS\\nExplicit rollback target verified\\nFollow-up smoke check required");
}

function productionRecover() {
  if (!hasFlag("--approve-recovery")) {
    fail("PRODUCTION_RECOVERY blocked: explicit --approve-recovery approval is required.");
  }
  const target = arg("--deployment");
  if (!target) {
    fail("PRODUCTION_RECOVERY blocked: explicit --deployment <deployment-id-or-url> is required.");
  }
  notify("WOS AI Dev Agent\n\nPRODUCTION_RECOVERY started\nExplicit human approval supplied");
  const recovery = run("npm.cmd", ["run", "production:recover", "--", "--approve-recovery", "--deployment", target]);
  if (!recovery.ok) {
    fail(
      "Production recovery failed or was blocked.\n" + recovery.output,
      "Production recovery failed or was blocked. No automatic retry or alternate target selection performed."
    );
  }
  console.log(recovery.output);
  console.log("PRODUCTION_RECOVERY PASS");
  console.log("Rollback completed and post-recovery smoke check passed.");
  notify("WOS AI Dev Agent\n\nPRODUCTION_RECOVERY PASS\nRollback target verified\nPost-recovery smoke check passed");
}

function productionDeploy() {
  if (!hasFlag("--approve-deploy")) {
    fail("PRODUCTION_DEPLOY blocked: explicit --approve-deploy approval is required.");
  }

  notify("WOS AI Dev Agent\n\n🔴 PRODUCTION_DEPLOY started\nExplicit human approval supplied");
  const deploy = run("npm.cmd", ["run", "production:deploy", "--", "--approve-deploy"]);
  if (!deploy.ok) {
    fail(
      "Production deploy failed.\n" + deploy.output,
      "Production deployment failed or was blocked. Check the deployment gate and Vercel verification."
    );
  }

  console.log(deploy.output);
  console.log("PRODUCTION_DEPLOY PASS");
  console.log("Production deployment completed and verified.");
  notify("WOS AI Dev Agent\n\n✅ PRODUCTION_DEPLOY PASS\nProduction deployment completed and verified\nAlias: www.wos.asia");
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
  notify(`WOS AI Dev Agent\n\n${passed ? "🟢 PASS" : "❌ FAIL"}\nMode: READ_ONLY\nBranch: ${branch}\nCommit: ${commit}`);
  process.exit(passed ? 0 : 1);
}

const mode = arg("--mode") || "read-only";

if (hasFlag("--help")) {
  console.log("Modes: read-only | plan | edit-dev | verify-change | run-tests | operational-status | production-gate | production-deploy | production-rollback | production-recovery-check | production-smoke-check | production-recover");
  console.log("PLAN: --mode plan --task <description>");
  console.log("EDIT_DEV: --mode edit-dev --file <path> --old <text> --new <text>");
  console.log("VERIFY_CHANGE: --mode verify-change");
  console.log("RUN_TESTS: --mode run-tests [--base-url <local-test-url>]");
  console.log("OPERATIONAL_STATUS: --mode operational-status [--include-regression]");
  console.log("REPOSITORY_INTELLIGENCE: --mode repo-intelligence [--query <task>] [--limit <n>] [--json]");
  console.log("AUDIT_HISTORY: --mode audit-history [--limit <n>] [--since <date>] [--json]");
  console.log("PRODUCTION_GATE: --mode production-gate [--skip-build]");
  console.log("PRODUCTION_DEPLOY: --mode production-deploy --approve-deploy");
  console.log("PRODUCTION_ROLLBACK: --mode production-rollback --approve-rollback --deployment <id-or-url>");
  console.log("PRODUCTION_RECOVERY_CHECK: --mode production-recovery-check");
  console.log("PRODUCTION_SMOKE_CHECK: --mode production-smoke-check");
  console.log("PRODUCTION_RECOVER: --mode production-recover --approve-recovery --deployment <id-or-url>");
  process.exit(0);
}

if (mode === "repo-intelligence") repoIntelligence();
else if (mode === "edit-dev") editDev();
else if (mode === "operational-status") operationalStatus();
else if (mode === "audit-history") auditHistory();
else if (mode === "plan") plan();
else if (mode === "verify-change") verifyChange();
else if (mode === "run-tests") runTests();
else if (mode === "production-gate") productionGate();
else if (mode === "production-deploy") productionDeploy();
else if (mode === "production-rollback") productionRollback();
else if (mode === "production-recover") productionRecover();
else if (mode === "production-recovery-check") productionRecoveryCheck();
else if (mode === "production-smoke-check") productionSmokeCheck();
else if (mode === "read-only") readOnly();
else fail(`Unknown mode: ${mode}`);
