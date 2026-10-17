#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");

function runNpm(script, extraArgs = []) {
  const directScripts = {
    preflight: ["scripts/preflight-automation.mjs"],
    "ai:regression": ["ai-regression-test.mjs"],
    "production:guard": ["scripts/production-guard.mjs"],
  };
  const direct = directScripts[script];
  const child = direct
    ? { command: process.execPath, args: [...direct, ...extraArgs.filter((arg) => arg !== "--")] }
    : process.platform === "win32"
      ? { command: "npm.cmd", args: ["run", script, ...extraArgs] }
      : { command: "npm", args: ["run", script, ...extraArgs] };

  const result = spawnSync(child.command, child.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: false,
  });

  return {
    ok: result.status === 0,
    output: result.error?.message || "",
  };
}

function fail(stage, detail) {
  console.error("");
  console.error(`[FAIL] ${stage}`);
  if (detail) console.error(detail);
  console.error("");
  console.error("PRODUCTION DEPLOYMENT GATE FAILED — deployment is blocked.");
  process.exit(1);
}

function pass(stage) {
  console.log(`[PASS] ${stage}`);
}

console.log("WOS.os Production Deployment Gate");
console.log("Target: wos-platform-updated / www.wos.asia");
console.log(`Build: ${skipBuild ? "SKIPPED" : "REQUIRED"}`);
console.log("");

console.log("=== 1. Preflight ===");
const preflight = runNpm("preflight", skipBuild ? ["--", "--skip-build"] : []);
if (!preflight.ok) fail("Preflight", preflight.output);
console.log(preflight.output);
pass("Preflight");

console.log("");
console.log("=== 2. AI Regression ===");
const regression = runNpm("ai:regression");
if (!regression.ok) fail("AI Regression", regression.output);
console.log(regression.output);
pass("AI Regression");

console.log("");
console.log("=== 3. Production Target Guard ===");
const guard = runNpm("production:guard");
if (!guard.ok) fail("Production Guard", guard.output);
console.log(guard.output);
pass("Production Target Guard");

console.log("");
console.log("========================================");
console.log(" PRODUCTION DEPLOYMENT GATE PASSED");
console.log("========================================");
console.log("Deployment has NOT been performed.");
console.log("Human approval is required for commit/push/deploy.");
