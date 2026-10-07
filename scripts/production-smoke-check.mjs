#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const EXPECTED_PROJECT = "wos-platform-updated";
const EXPECTED_ALIAS = "www.wos.asia";
const EXPECTED_URL = "https://www.wos.asia/";

function inspectProduction() {
  try {
    const output = process.platform === "win32"
      ? execFileSync("cmd.exe", ["/d", "/s", "/c", "vercel.cmd inspect " + EXPECTED_ALIAS + " --json"], {
          cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        })
      : execFileSync("vercel", ["inspect", EXPECTED_ALIAS, "--json"], {
          cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        });
    return JSON.parse(output);
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message;
    throw new Error("Vercel inspect failed: " + detail);
  }
}

function fail(message) {
  console.error("[FAIL] " + message);
  console.error("PRODUCTION SMOKE CHECK FAILED — no deployment or rollback performed.");
  process.exit(1);
}

console.log("WOS.os Production Post-Deploy Smoke Check");
console.log("Project: " + EXPECTED_PROJECT);
console.log("Alias: " + EXPECTED_ALIAS);
console.log("");

let deployment;
try {
  deployment = inspectProduction();
} catch (error) {
  fail(error.message);
}

if (deployment.name !== EXPECTED_PROJECT) fail("Wrong Vercel project: " + deployment.name);
console.log("[PASS] Project: " + deployment.name);
if (deployment.target !== "production") fail("Deployment target is " + deployment.target);
console.log("[PASS] Target: production");
if (deployment.readyState !== "READY") fail("Deployment state is " + deployment.readyState);
console.log("[PASS] Ready state: READY");
if (!deployment.aliases?.includes(EXPECTED_ALIAS)) fail("Alias is not attached: " + EXPECTED_ALIAS);
console.log("[PASS] Alias attached: " + EXPECTED_ALIAS);
console.log("[PASS] Deployment: " + deployment.id);
console.log("");

const response = await fetch(EXPECTED_URL, {
  method: "GET",
  redirect: "follow",
  signal: AbortSignal.timeout(15000),
  headers: { "user-agent": "WOS-AI-Dev-Agent-Smoke-Check/1.0" },
});

console.log("=== Production HTTP Smoke ===");
console.log("URL: " + EXPECTED_URL);
console.log("HTTP status: " + response.status);
if (response.status !== 200) fail("Production root did not return HTTP 200.");
const contentType = response.headers.get("content-type") || "";
if (!contentType.toLowerCase().includes("text/html")) {
  fail("Production root did not return HTML content-type: " + contentType);
}
console.log("[PASS] HTTP 200");
console.log("[PASS] Content-Type: " + contentType.split(";")[0]);

const body = await response.text();
if (!body || body.length < 100) fail("Production root returned an unexpectedly small HTML response.");
if (/application error|internal server error|unhandled runtime error/i.test(body)) {
  fail("Production root contains an application/runtime error marker.");
}
console.log("[PASS] HTML body present");
console.log("");
console.log("PRODUCTION_SMOKE_CHECK PASS");
console.log("Read-only: no deployment or rollback performed.");
