#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const ROOT = process.cwd();

function run(command, args = []) {
  try {
    return execFileSync(command, args, { shell: process.platform === "win32",
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    return `ERROR: ${error.stderr?.toString().trim() || error.message}`;
  }
}

const requiredFiles = [
  "package.json",
  "Dockerfile",
  "preflight-build.ps1",
  "ai-regression-test.mjs",
  "scripts/telegram-notify.mjs",
];

const branch = run("git", ["branch", "--show-current"]);
const commit = run("git", ["rev-parse", "--short", "HEAD"]);
const status = run("git", ["status", "--short"]);
const nodeVersion = run("node", ["--version"]);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmVersion = run(npmCommand, ["--version"]);
const diffCheck = run("git", ["diff", "--check"]);

const missingFiles = requiredFiles.filter((file) => !existsSync(file));

const checks = {
  gitRepo: !branch.startsWith("ERROR:"),
  node: !nodeVersion.startsWith("ERROR:"),
  npm: !npmVersion.startsWith("ERROR:"),
  requiredFiles: missingFiles.length === 0,
  diffCheck: !diffCheck.startsWith("ERROR:"),
};

const passed = Object.values(checks).every(Boolean);

const report = [
  "WOS AI Dev Agent Report",
  "",
  "Mode: READ_ONLY",
  `Branch: ${branch}`,
  `Commit: ${commit}`,
  "",
  "Checks:",
  `- Git repository: ${checks.gitRepo ? "PASS" : "FAIL"}`,
  `- Node: ${checks.node ? "PASS" : "FAIL"}`,
  `- npm: ${checks.npm ? "PASS" : "FAIL"}`,
  `- Required files: ${checks.requiredFiles ? "PASS" : "FAIL"}`,
  `- Git diff check: ${checks.diffCheck ? "PASS" : "FAIL"}`,
  "",
  `Git status: ${status || "clean"}`,
  missingFiles.length ? `Missing: ${missingFiles.join(", ")}` : "",
  "",
  `Overall: ${passed ? "PASS" : "FAIL"}`,
  "Security: No secrets read or printed",
  "Production touched: NO",
  "Commit: NOT YET",
  "Push: NOT YET",
  "Deploy: NOT YET",
].filter(Boolean).join("\n");

console.log(report);

if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  try {
    execFileSync(
      "node",
      [
        "scripts/telegram-notify.mjs",
        `WOS AI Dev Agent\n\n${passed ? "PASS" : "FAIL"}\nMode: READ_ONLY\nBranch: ${branch}\nCommit: ${commit}`,
      ],
      { cwd: ROOT, stdio: "inherit" }
    );
  } catch {
    console.error("Telegram notification failed.");
  }
}

process.exit(passed ? 0 : 1);
