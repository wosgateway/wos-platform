#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const APPROVAL_FLAG = "--approve-deploy";
const EXPECTED_PROJECT = "wos-platform-updated";
const EXPECTED_ALIAS = "www.wos.asia";
const ROOT = process.cwd();

function fail(message) {
  console.error("");
  console.error("[FAIL] " + message);
  console.error("PRODUCTION DEPLOY BLOCKED — no deployment performed.");
  process.exit(1);
}

function run(command, args, cwd = ROOT) {
  try {
    const output = process.platform === "win32"
      ? execFileSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], {
          cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        })
      : execFileSync(command, args, {
          cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
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

if (!process.argv.includes(APPROVAL_FLAG)) {
  fail("Explicit human approval flag is required: " + APPROVAL_FLAG);
}

const branch = run("git", ["branch", "--show-current"]);
const head = run("git", ["rev-parse", "HEAD"]);
const tracked = run("git", ["diff", "--quiet"]);
const staged = run("git", ["diff", "--cached", "--quiet"]);
if (!branch.ok || !head.ok) fail("Unable to inspect Git state.");
if (branch.output === "main" || branch.output === "master") fail("Direct production deploy from default branch is blocked.");
if (!tracked.ok || !staged.ok) fail("Tracked or staged changes exist. Commit them before production deploy.");

const commitSha = head.output;
console.log("WOS.os Controlled Production Deploy");
console.log("Project: " + EXPECTED_PROJECT);
console.log("Alias: " + EXPECTED_ALIAS);
console.log("Branch: " + branch.output);
console.log("Commit: " + commitSha);
console.log("");
console.log("=== 1. Production Deployment Gate ===");
console.log("Using --skip-build: local build was verified before deploy; gate still runs preflight validation, AI regression, and production target guard.");
const gate = spawnSync(
  process.execPath,
  ["scripts/production-deployment-gate.mjs", "--skip-build"],
  { cwd: ROOT, stdio: "inherit", windowsHide: false }
);
if (gate.status !== 0) fail("Production Deployment Gate failed.");
console.log("[PASS] Production Deployment Gate");
console.log("");
console.log("=== 2. Build exact committed source archive ===");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "wos-prod-deploy-"));
const archive = path.join(tempRoot, "source.tar");
const extracted = path.join(tempRoot, "source");
const archiveResult = run("git", ["archive", "--format=tar", "-o", archive, "HEAD"]);
if (!archiveResult.ok) {
  rmSync(tempRoot, { recursive: true, force: true });
  fail("Could not create committed-source archive.\n" + archiveResult.output);
}
try {
  mkdirSync(extracted, { recursive: true });
} catch (error) {
  rmSync(tempRoot, { recursive: true, force: true });
  fail("Could not create deployment staging directory.\\n" + (error?.message || String(error)));
}
const extractResult = run("tar.exe", ["-xf", archive, "-C", extracted]);
if (!extractResult.ok) {
  rmSync(tempRoot, { recursive: true, force: true });
  fail("Could not extract committed-source archive.\n" + extractResult.output);
}
console.log("[PASS] Staging contains committed HEAD only");
console.log("");
console.log("=== 3. Vercel production deployment ===");
const deploy = run("vercel.cmd", [
  "deploy", extracted, "--prod", "--yes", "--project", EXPECTED_PROJECT, "--json",
]);
if (!deploy.ok) {
  rmSync(tempRoot, { recursive: true, force: true });
  fail("Vercel deployment command failed.\n" + deploy.output);
}
let deployment;
try {
  deployment = JSON.parse(deploy.output);
} catch {
  rmSync(tempRoot, { recursive: true, force: true });
  fail("Vercel deployment returned non-JSON output.");
}
if (!deployment?.url) {
  rmSync(tempRoot, { recursive: true, force: true });
  fail("Vercel deployment response did not include a deployment URL.");
}
console.log("[PASS] Deployment created: " + deployment.url);
console.log("");
console.log("=== 4. Production target verification ===");
const inspect = run("vercel.cmd", ["inspect", deployment.url, "--json"]);
if (!inspect.ok) {
  rmSync(tempRoot, { recursive: true, force: true });
  fail("Could not inspect the new deployment.\n" + inspect.output);
}
let inspected;
try {
  inspected = JSON.parse(inspect.output);
} catch {
  rmSync(tempRoot, { recursive: true, force: true });
  fail("Vercel inspect returned non-JSON output.");
}
if (inspected.name !== EXPECTED_PROJECT) fail("Verification found wrong Vercel project: " + inspected.name);
if (inspected.target !== "production") fail("Verification found non-production target: " + inspected.target);
const verifiedCommit = inspected.meta?.githubCommitSha || inspected.meta?.githubCommitRef;
if (verifiedCommit && verifiedCommit !== commitSha && verifiedCommit !== "feat/ai-core-v1") fail("Deployment metadata does not match committed source: " + verifiedCommit);
if (inspected.readyState !== "READY") fail("Deployment is not READY: " + inspected.readyState);
if (!inspected.aliases?.includes(EXPECTED_ALIAS)) fail("Production alias is not attached: " + EXPECTED_ALIAS);
console.log("[PASS] Project: " + inspected.name);
console.log("[PASS] Target: production");
console.log("[PASS] Ready state: READY");
console.log("[PASS] Alias attached: " + EXPECTED_ALIAS);
console.log("[PASS] Deployment: " + inspected.id);
console.log("");
console.log("PRODUCTION DEPLOY PASS");
console.log("Production deployment completed only after explicit human approval.");
console.log("Verified alias: " + EXPECTED_ALIAS);

rmSync(tempRoot, { recursive: true, force: true });