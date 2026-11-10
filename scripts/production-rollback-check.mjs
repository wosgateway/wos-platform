#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const EXPECTED_PROJECT = "wos-platform-updated";
const EXPECTED_ALIAS = "www.wos.asia";
const LIMIT = 20;

function runVercel(args) {
  try {
    const output = process.platform === "win32"
      ? execFileSync("cmd.exe", ["/d", "/s", "/c", "vercel.cmd " + args.join(" ")], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      : execFileSync("vercel", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(output);
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message;
    throw new Error(`Vercel command failed: ${detail}`);
  }
}

function inspect(target) { return runVercel(["inspect", target, "--json"]); }
function fail(message) {
  console.error(`[FAIL] ${message}`);
  console.error("ROLLBACK CHECK FAILED — do not run rollback.");
  process.exit(1);
}

console.log("WOS.os Production Rollback Check");
console.log(`Project: ${EXPECTED_PROJECT}`);
console.log(`Production alias: ${EXPECTED_ALIAS}`);
console.log("Read-only: no rollback or deployment is performed.");
console.log("");

const current = inspect(EXPECTED_ALIAS);
if (current.name !== EXPECTED_PROJECT) fail(`Wrong Vercel project: ${current.name}`);
if (current.target !== "production") fail(`Current target is ${current.target}`);
if (current.readyState !== "READY") fail(`Current state is ${current.readyState}`);
if (!current.aliases?.includes(EXPECTED_ALIAS)) fail(`Alias is not attached: ${EXPECTED_ALIAS}`);
if (!Number.isFinite(current.createdAt)) fail("Current deployment has no usable createdAt timestamp.");

console.log(`[PASS] Current production: ${current.id}`);
console.log(`[PASS] Current URL: ${current.url}`);
console.log(`[PASS] Current createdAt: ${new Date(current.createdAt).toISOString()}`);

const listing = runVercel(["ls", EXPECTED_PROJECT, "--json", "--status", "READY", "--limit", String(LIMIT)]);
const deployments = Array.isArray(listing.deployments) ? listing.deployments : [];
const older = deployments
  .filter((deployment) => deployment.url !== current.url && Number.isFinite(deployment.createdAt) && deployment.createdAt < current.createdAt)
  .sort((a, b) => b.createdAt - a.createdAt);

const candidate = older[0];
if (!candidate) fail("No older READY deployment candidate was found.");

const previous = inspect(candidate.url);
if (previous.name !== EXPECTED_PROJECT) fail(`Rollback candidate belongs to ${previous.name}`);
if (previous.readyState !== "READY") fail(`Rollback candidate state is ${previous.readyState}`);
if (!(previous.createdAt < current.createdAt)) fail("Rollback candidate is not older than current production.");

console.log("");
console.log("[PASS] Previous READY deployment candidate found");
console.log(`Candidate URL: ${previous.url}`);
console.log(`Candidate ID: ${previous.id}`);
console.log(`Candidate createdAt: ${new Date(previous.createdAt).toISOString()}`);
console.log(`Candidate commit: ${previous.meta?.githubCommitSha || "unknown"}`);
console.log(`Candidate message: ${previous.meta?.githubCommitMessage || "unknown"}`);
console.log("");
console.log("ROLLBACK CHECK PASSED — older candidate identified; no rollback performed.");
console.log("Human approval is required before any rollback action.");
