#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const EXPECTED_PROJECT = "wos-platform-updated";
const EXPECTED_ALIAS = "www.wos.asia";
const args = process.argv.slice(2);

function has(name) { return args.includes(name); }
function value(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function fail(message) {
  console.error(`[FAIL] ${message}`);
  console.error("PRODUCTION RECOVERY BLOCKED — no recovery action completed.");
  process.exit(1);
}
function run(command, commandArgs) {
  try {
    return execFileSync(command, commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    throw new Error(error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message);
  }
}

if (!has("--approve-recovery")) fail("Explicit human approval flag is required: --approve-recovery");
const target = value("--deployment");
if (!target) fail("Explicit rollback target is required: --deployment <deployment-id-or-url>");
if (has("--help")) {
  console.log("Usage: npm run production:recover -- --approve-recovery --deployment <deployment-id-or-url>");
  process.exit(0);
}

console.log("WOS.os Controlled Production Recovery");
console.log(`Project: ${EXPECTED_PROJECT}`);
console.log(`Alias: ${EXPECTED_ALIAS}`);
console.log(`Approved target: ${target}`);
console.log("=== PRE-RECOVERY ROLLBACK ===");
run("npm.cmd", ["run", "production:rollback", "--", "--approve-rollback", "--deployment", target]);

console.log("=== POST-RECOVERY SMOKE ===");
run("npm.cmd", ["run", "production:smoke:check"]);

console.log("PRODUCTION_RECOVERY PASS");
console.log("Rollback target verified and post-recovery smoke check passed.");
console.log("No automatic retry or alternate target selection was performed.");
