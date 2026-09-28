#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const APPROVAL_FLAG = "--approve-rollback";
const TARGET_FLAG = "--deployment";
const EXPECTED_PROJECT = "wos-platform-updated";
const EXPECTED_ALIAS = "www.wos.asia";

function fail(message) {
  console.error("");
  console.error("[FAIL] " + message);
  console.error("PRODUCTION ROLLBACK BLOCKED — no rollback performed.");
  process.exit(1);
}

function runVercel(args) {
  try {
    const output = process.platform === "win32"
      ? execFileSync("cmd.exe", ["/d", "/s", "/c", "vercel.cmd " + args.join(" ")], {
          cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        })
      : execFileSync("vercel", args, {
          cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        });
    return JSON.parse(output);
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message;
    throw new Error("Vercel command failed: " + detail);
  }
}

function run(command, args) {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, {
        cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      output: error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message,
    };
  }
}

if (!process.argv.includes(APPROVAL_FLAG)) {
  fail("Explicit human approval flag is required: " + APPROVAL_FLAG);
}

const targetIndex = process.argv.indexOf(TARGET_FLAG);
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
if (!target || target.startsWith("--")) {
  fail("Explicit target is required: --deployment <deployment-id-or-url>.");
}

const branch = run("git", ["branch", "--show-current"]);
const tracked = run("git", ["diff", "--quiet"]);
const staged = run("git", ["diff", "--cached", "--quiet"]);
if (!branch.ok || !tracked.ok || !staged.ok) {
  fail("Tracked or staged changes exist, or Git state could not be inspected.");
}

console.log("WOS.os Controlled Production Rollback");
console.log("Project: " + EXPECTED_PROJECT);
console.log("Alias: " + EXPECTED_ALIAS);
console.log("Target: " + target);
console.log("Branch: " + branch.output);
console.log("");
console.log("=== 1. Verify current production and explicit rollback target ===");

let current;
let candidate;
try {
  current = runVercel(["inspect", EXPECTED_ALIAS, "--json"]);
  candidate = runVercel(["inspect", target, "--json"]);
} catch (error) {
  fail(error.message);
}

if (current.name !== EXPECTED_PROJECT) fail("Current production belongs to wrong project: " + current.name);
if (current.target !== "production") fail("Current production target is " + current.target);
if (current.readyState !== "READY") fail("Current production is not READY: " + current.readyState);
if (!current.aliases?.includes(EXPECTED_ALIAS)) fail("Production alias is not attached: " + EXPECTED_ALIAS);
if (!Number.isFinite(current.createdAt)) fail("Current production has no usable createdAt timestamp.");

if (candidate.name !== EXPECTED_PROJECT) fail("Rollback target belongs to wrong project: " + candidate.name);
if (candidate.readyState !== "READY") fail("Rollback target is not READY: " + candidate.readyState);
if (!Number.isFinite(candidate.createdAt)) fail("Rollback target has no usable createdAt timestamp.");
if (!(candidate.createdAt < current.createdAt)) fail("Rollback target is not older than current production.");
if (candidate.id === current.id || candidate.url === current.url) fail("Rollback target is already the current production deployment.");

console.log("[PASS] Current production: " + current.id);
console.log("[PASS] Current state: READY");
console.log("[PASS] Current alias: " + EXPECTED_ALIAS);
console.log("[PASS] Target project: " + candidate.name);
console.log("[PASS] Target state: READY");
console.log("[PASS] Target is older than current production: " + candidate.id);
console.log("");

console.log("=== 2. Execute Vercel rollback ===");
let rollback;
try {
  rollback = runVercel(["rollback", target, "--yes"]);
} catch (error) {
  fail(error.message);
}

console.log("[PASS] Vercel rollback command completed.");
console.log("Rollback result deployment: " + (rollback.id || rollback.url || "verified by follow-up inspect"));
console.log("");

console.log("=== 3. Verify production alias after rollback ===");
let after;
try {
  after = runVercel(["inspect", EXPECTED_ALIAS, "--json"]);
} catch (error) {
  fail("Post-rollback production inspection failed: " + error.message);
}

if (after.name !== EXPECTED_PROJECT) fail("Post-rollback project mismatch: " + after.name);
if (after.target !== "production") fail("Post-rollback target is " + after.target);
if (after.readyState !== "READY") fail("Post-rollback deployment is not READY: " + after.readyState);
if (!after.aliases?.includes(EXPECTED_ALIAS)) fail("Post-rollback alias is not attached: " + EXPECTED_ALIAS);
if (after.id !== candidate.id && after.url !== candidate.url) {
  fail("Production alias did not move to the explicitly approved rollback target.");
}

console.log("[PASS] Production now points to target: " + after.id);
console.log("[PASS] Alias attached: " + EXPECTED_ALIAS);
console.log("");
console.log("PRODUCTION_ROLLBACK PASS");
console.log("Rollback completed only after explicit human approval.");
console.log("Follow-up smoke check is required before declaring recovery complete.");
