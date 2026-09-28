#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const includeRegression = args.includes("--include-regression");
const incident = args.includes("--incident");

function run(command, commandArgs = []) {
  try {
    const executable = process.platform === "win32" && command === "npm.cmd" ? "cmd.exe" : command;
    const executableArgs = process.platform === "win32" && command === "npm.cmd"
      ? ["/d", "/s", "/c", `npm.cmd ${commandArgs.join(" ")}`]
      : commandArgs;
    const output = execFileSync(executable, executableArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { ok: true, output };
  } catch (error) {
    return {
      ok: false,
      output: error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message,
    };
  }
}

function line(label, result) {
  console.log(`[${result.ok ? "PASS" : "FAIL"}] ${label}${result.output ? `: ${result.output.split(/\\r?\\n/)[0]}` : ""}`);
}

function printIncidentRunbook() {
  console.log("WOS AI Dev Agent Incident Runbook");
  console.log("");
  console.log("BUILD / TEST FAILURE");
  console.log("1. read-only status");
  console.log("2. plan the smallest DEV-only fix");
  console.log("3. edit-dev");
  console.log("4. verify-change");
  console.log("5. run-tests");
  console.log("6. human approval before commit/push");
  console.log("");
  console.log("PRODUCTION INCIDENT");
  console.log("1. production-smoke-check");
  console.log("2. production-recovery-check");
  console.log("3. identify an explicit older READY target");
  console.log("4. human approval for recovery");
  console.log("5. production-recover with the approved target");
  console.log("6. confirm post-recovery smoke PASS");
  console.log("");
  console.log("GUARDRAIL: no automatic rollback, retry, or alternate target selection.");
  console.log("GUARDRAIL: deployment, rollback, recovery, commit, and push require explicit human approval.");
}

if (incident) {
  printIncidentRunbook();
  process.exit(0);
}

const branch = run("git", ["branch", "--show-current"]);
const head = run("git", ["rev-parse", "--short", "HEAD"]);
const remote = run("git", ["rev-parse", "origin/feat/ai-core-v1"]);
const status = run("git", ["status", "--short"]);
const diff = run("git", ["diff", "--check"]);
const upstream = run("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);

console.log("WOS AI Dev Agent Operational Status");
console.log("");
line("Branch", branch);
line("HEAD", head);
line("Remote HEAD", remote);
line("Git diff check", diff);
line("Upstream", upstream);
console.log(`[INFO] Working tree: ${status.output || "clean"}`);
console.log("[INFO] Untracked WIP is reported only and is never included by controlled deploy/recovery paths.");
console.log("");

const guard = run("npm.cmd", ["run", "production:guard"]);
line("Production target guard", guard);

const smoke = run("npm.cmd", ["run", "production:smoke:check"]);
line("Production smoke", smoke);

const recovery = run("npm.cmd", ["run", "production:rollback:check"]);
line("Recovery candidate check", recovery);

if (includeRegression) {
  const baseUrl = process.env.WOS_TEST_BASE_URL || "http://127.0.0.1:3011";
  const regression = run("node", ["ai-regression-test.mjs", "--base-url", baseUrl]);
  line("AI regression", regression);
} else {
  console.log("[INFO] AI regression: not run (use --include-regression when the test server is available).");
}

const hardFailures = [branch, head, remote, diff, upstream, guard, smoke, recovery].filter((result) => !result.ok);
console.log("");
const overallOk = hardFailures.length === 0;
console.log(`Operational status: ${overallOk ? "PASS" : "REVIEW REQUIRED"}`);
console.log("Read-only: no files, Git history, or Production state changed.");
process.exit(overallOk ? 0 : 1);
