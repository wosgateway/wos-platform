#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");

function runNpm(script, extraArgs = []) {
  const command = ["npm.cmd", "run", script, ...extraArgs];
  try {
    const output = process.platform === "win32"
      ? execFileSync("cmd.exe", ["/d", "/s", "/c", command.join(" ")], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        })
      : execFileSync("npm", ["run", script, ...extraArgs], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });

    return { ok: true, output: output.trim() };
  } catch (error) {
    return {
      ok: false,
      output: error.stdout?.toString().trim()
        || error.stderr?.toString().trim()
        || error.message,
    };
  }
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
