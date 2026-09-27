#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipBuild = args.has("--skip-build");

function run(command, commandArgs = []) {
  try {
    const executable = process.platform === "win32" && command === "npm.cmd"
      ? "cmd.exe"
      : command;
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

function pass(message) { console.log(`[PASS] ${message}`); }
function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

console.log("WOS.os Preflight Automation");
console.log(`Mode: ${dryRun ? "DRY_RUN" : skipBuild ? "VALIDATE_ONLY" : "FULL"}`);
console.log("");

const requiredFiles = [
  "package.json",
  "Dockerfile",
  ".dockerignore",
  "preflight-build.ps1",
  "ai-regression-test.mjs",
  "scripts/wos-ai-agent.mjs",
  "scripts/telegram-notify.mjs",
];

for (const file of requiredFiles) {
  if (existsSync(file)) pass(`Required file: ${file}`);
  else fail(`Missing required file: ${file}`);
}

const node = run("node", ["--version"]);
if (node.ok) pass(`Node ${node.output}`); else fail("Node.js unavailable");

const npm = run(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]);
if (npm.ok) pass(`npm ${npm.output}`); else fail("npm unavailable");

const docker = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
if (docker.ok) pass(`Docker daemon ${docker.output}`);
else fail("Docker daemon unavailable");

const git = run("git", ["diff", "--check"]);
if (git.ok) pass("Git diff check"); else fail(`Git diff check failed: ${git.output}`);

const envPath = ".env.local";
if (!existsSync(envPath)) {
  fail(".env.local is missing");
} else {
  const envText = run("powershell.exe", [
    "-NoProfile", "-Command",
    `Get-Content '${envPath}' | Select-String -Pattern '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|LITELLM_BASE_URL|LITELLM_MODEL)=' | ForEach-Object { $_.Line.Split('=',2)[0] }`
  ]);
  const names = new Set(envText.output.split(/\r?\n/).filter(Boolean));
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "LITELLM_BASE_URL",
    "LITELLM_MODEL",
  ]) {
    if (names.has(key)) pass(`Env key present: ${key}`);
    else fail(`Env key missing: ${key}`);
  }
}

if (process.exitCode) {
  console.error("\nPREFLIGHT AUTOMATION FAILED");
  process.exit(1);
}

if (dryRun) {
  console.log("\nPREFLIGHT AUTOMATION PASSED (DRY RUN)");
  process.exit(0);
}

console.log("\n=== Existing build preflight ===");
const preflightArgs = [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ".\\preflight-build.ps1"
];
if (skipBuild) preflightArgs.push("-SkipBuild");
const preflight = run("powershell.exe", preflightArgs);
if (!preflight.ok) {
  console.error(preflight.output);
  console.error("\nPREFLIGHT AUTOMATION FAILED");
  process.exit(1);
}

console.log(preflight.output);
console.log("\nPREFLIGHT AUTOMATION PASSED");
