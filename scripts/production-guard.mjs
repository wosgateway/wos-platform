#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const EXPECTED_PROJECT = "wos-platform-updated";
const EXPECTED_ALIAS = "www.wos.asia";

function inspect(target) {
  try {
    const output = process.platform === "win32"
      ? execFileSync("cmd.exe", ["/d", "/s", "/c", "vercel.cmd inspect " + target + " --json"], {
          cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        })
      : execFileSync("vercel", ["inspect", target, "--json"], {
          cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        });
    return JSON.parse(output);
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message;
    throw new Error(`Vercel inspect failed: ${detail}`);
  }
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  console.error("PRODUCTION GUARD FAILED — do not promote/deploy.");
  process.exit(1);
}

console.log("WOS.os Production Guard");
console.log(`Target alias: ${EXPECTED_ALIAS}`);
console.log(`Expected project: ${EXPECTED_PROJECT}`);
console.log("");

const deployment = inspect(EXPECTED_ALIAS);
if (deployment.name !== EXPECTED_PROJECT) fail(`Wrong Vercel project: ${deployment.name}`);
console.log(`[PASS] Project: ${deployment.name}`);
if (deployment.target !== "production") fail(`Deployment target is ${deployment.target}`);
console.log("[PASS] Target: production");
if (deployment.readyState !== "READY") fail(`Deployment state is ${deployment.readyState}`);
console.log("[PASS] Ready state: READY");
if (!deployment.aliases?.includes(EXPECTED_ALIAS)) fail(`Alias not attached: ${EXPECTED_ALIAS}`);
console.log(`[PASS] Alias attached: ${EXPECTED_ALIAS}`);
console.log(`[PASS] Deployment: ${deployment.id}`);
console.log("PRODUCTION GUARD PASSED — target is safe to inspect/promote.");
