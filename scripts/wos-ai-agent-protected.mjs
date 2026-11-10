#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();

const APPROVAL_SCRIPT = path.join(
  ROOT,
  "scripts",
  "wos-ai-agent-telegram-approval.mjs"
);

const GIT_GATE_SCRIPT = path.join(
  ROOT,
  "scripts",
  "wos-ai-agent-git-gate.mjs"
);

function runNode(script, args = []) {
  try {
    execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "inherit",
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      output:
        error.stderr?.toString() ||
        error.stdout?.toString() ||
        error.message,
    };
  }
}

function runNpm(script, args = []) {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";

  try {
    execFileSync(executable, ["run", script, "--", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "inherit",
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      output:
        error.stderr?.toString() ||
        error.stdout?.toString() ||
        error.message,
    };
  }
}

function fail(message) {
  console.error(`[PROTECTED ACTION BLOCKED] ${message}`);
  process.exit(1);
}

function usage() {
  console.log(`
WOS AI Dev Agent - Telegram Protected Gate

COMMIT:
  node scripts/wos-ai-agent-protected.mjs commit --files "file1,file2" --message "message"

PUSH:
  node scripts/wos-ai-agent-protected.mjs push

DEPLOY:
  node scripts/wos-ai-agent-protected.mjs deploy

ROLLBACK:
  node scripts/wos-ai-agent-protected.mjs rollback --deployment <id-or-url>

RECOVERY:
  node scripts/wos-ai-agent-protected.mjs recovery --deployment <id-or-url>
`);
}

const action = process.argv[2];

if (!action || action === "--help") {
  usage();
  process.exit(action === "--help" ? 0 : 1);
}

const allowed = new Set([
  "commit",
  "push",
  "deploy",
  "rollback",
  "recovery",
]);

if (!allowed.has(action)) {
  fail(`Unsupported protected action: ${action}`);
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;

  const value = process.argv[index + 1];

  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${name}.`);
  }

  return value;
}

const files = getArg("--files");
const message = getArg("--message");
const deployment = getArg("--deployment");

if (action === "commit") {
  if (!files) {
    fail(
      'COMMIT requires explicit --files "file1,file2". Never use git add .'
    );
  }

  if (!message) {
    fail("COMMIT requires explicit --message.");
  }
}

if ((action === "rollback" || action === "recovery") && !deployment) {
  fail(
    `${action.toUpperCase()} requires explicit --deployment <id-or-url>.`
  );
}

const details = [
  action.toUpperCase(),
  files ? `files=${files}` : null,
  message ? `message=${message}` : null,
  deployment ? `deployment=${deployment}` : null,
]
  .filter(Boolean)
  .join(" | ");

console.log("");
console.log("========================================");
console.log("WOS AI DEV AGENT - PROTECTED ACTION");
console.log("========================================");
console.log(`Action: ${action}`);
console.log(`Details: ${details}`);
console.log("");

console.log("Requesting Telegram approval...");

const approval = runNode(APPROVAL_SCRIPT, [
  action.toUpperCase(),
  details,
]);

if (!approval.ok) {
  fail(
    `Telegram approval was not granted. ${
      approval.output || "Action stopped."
    }`
  );
}

console.log("");
console.log(`TELEGRAM APPROVAL PASSED: ${action}`);
console.log("");

let result;

if (action === "commit") {
  const explicitFiles = files
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (explicitFiles.length === 0) {
    fail("No explicit files supplied.");
  }

  if (explicitFiles.some((item) => item === "." || item === "..")) {
    fail("Invalid commit file allowlist.");
  }

  console.log("Executing Git Gate COMMIT with explicit file allowlist...");

  result = runNode(GIT_GATE_SCRIPT, [
    "--mode",
    "commit",
    "--files",
    explicitFiles.join(","),
    "--message",
    message,
    "--approve-commit",
  ]);
}

if (action === "push") {
  console.log("Executing Git Gate PUSH...");

  result = runNode(GIT_GATE_SCRIPT, [
    "--mode",
    "push",
    "--approve-push",
  ]);
}

if (action === "deploy") {
  console.log("Executing production deploy gate...");

  result = runNpm("production:deploy", [
    "--approve-deploy",
  ]);
}

if (action === "rollback") {
  console.log("Executing production rollback gate...");

  result = runNpm("production:rollback", [
    "--approve-rollback",
    "--deployment",
    deployment,
  ]);
}

if (action === "recovery") {
  console.log("Executing production recovery gate...");

  result = runNpm("production:recover", [
    "--approve-recovery",
    "--deployment",
    deployment,
  ]);
}

if (!result?.ok) {
  fail(
    `${action.toUpperCase()} failed or was blocked. ${
      result?.output || "No additional output."
    }`
  );
}

console.log("");
console.log(`PROTECTED ACTION PASS: ${action}`);
console.log("Telegram approval + downstream hard gate both passed.");
console.log("");
