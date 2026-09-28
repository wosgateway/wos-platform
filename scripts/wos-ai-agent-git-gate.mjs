#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(name);

function run(command, commandArgs = []) {
  try {
    const executable = process.platform === "win32" && command === "npm.cmd" ? "cmd.exe" : command;
    const executableArgs = process.platform === "win32" && command === "npm.cmd"
      ? ["/d", "/s", "/c", `npm.cmd ${commandArgs.join(" ")}`]
      : commandArgs;
    const output = execFileSync(executable, executableArgs, {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: error.stderr?.toString().trim() || error.stdout?.toString().trim() || error.message };
  }
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function safeRelative(file) {
  const normalized = path.normalize(file);
  const absolute = path.resolve(ROOT, normalized);
  const root = realpathSync(ROOT);
  if (!absolute.startsWith(root + path.sep)) fail(`Blocked path outside repository: ${file}`);
  if (/(^|[\\/])(?:\.git|node_modules)(?:[\\/]|$)/i.test(normalized)) fail(`Blocked protected path: ${file}`);
  if (/(^|[\\/])\.env(?:\.|$)/i.test(normalized)) fail(`Blocked environment file: ${file}`);
  const normalizedForward = normalized.split(path.sep).join("/").toLowerCase();
  if (/production|prod(?:uction)?[-_]?config/i.test(normalized) && normalizedForward !== "scripts/production-deploy.mjs") fail(`Blocked production path: ${file}`);
  if (!existsSync(absolute)) fail(`File does not exist: ${file}`);
  return path.relative(ROOT, absolute).split(path.sep).join("/");
}

function protectedName(name) {
  if (name.replaceAll("\\", "/").toLowerCase() === "scripts/production-deploy.mjs") return false;
  return /(^|[\\/])(?:\.env(?:\.|$)|\.git(?:[\\/]|$)|node_modules(?:[\\/]|$)|production|prod(?:uction)?[-_]?config)/i.test(name);
}

function changedNames() {
  const unstaged = run("git", ["diff", "--name-only"]);
  const staged = run("git", ["diff", "--cached", "--name-only"]);
  if (!unstaged.ok || !staged.ok) fail("Unable to inspect git changes.");
  return [...new Set(`${unstaged.output}\n${staged.output}`.split(/\r?\n/).filter(Boolean))];
}

function verify() {
  const diff = run("git", ["diff", "--check"]);
  if (!diff.ok) fail(`git diff --check failed: ${diff.output}`);
  for (const name of changedNames()) if (protectedName(name)) fail(`Protected path detected: ${name}`);
  const branch = run("git", ["branch", "--show-current"]);
  if (!branch.ok || !branch.output) fail("Unable to determine current branch.");
  console.log(`Branch: ${branch.output}`);
  console.log(`Changes: ${changedNames().join(", ") || "none"}`);
  console.log("VERIFY_CHANGE PASS");
}

function commit() {
  if (!has("--approve-commit")) fail("COMMIT requires explicit --approve-commit human approval.");
  verify();
  const files = arg("--files");
  if (!files) fail("COMMIT requires --files with an explicit comma-separated allowlist.");
  const list = files.split(",").map((x) => x.trim()).filter(Boolean).map(safeRelative);
  if (!list.length) fail("COMMIT file allowlist is empty.");
  const add = run("git", ["add", "--", ...list]);
  if (!add.ok) fail(`git add failed: ${add.output}`);
  const staged = run("git", ["diff", "--cached", "--name-only"]);
  if (!staged.ok) fail(`Unable to inspect staged files: ${staged.output}`);
  const stagedNames = staged.output.split(/\r?\n/).filter(Boolean);
  const unexpected = stagedNames.filter((name) => !list.includes(name));
  if (unexpected.length) fail(`Unexpected staged files: ${unexpected.join(", ")}`);
  if (stagedNames.some(protectedName)) fail("Protected path reached staging; commit blocked.");
  const message = arg("--message");
  if (!message) fail("COMMIT requires --message.");
  const result = run("git", ["commit", "-m", message]);
  if (!result.ok) fail(`git commit failed: ${result.output}`);
  console.log(result.output);
  console.log("COMMIT PASS — explicit human approval was supplied.");
  console.log("PUSH NOT PERFORMED.");
}

function push() {
  if (!has("--approve-push")) fail("PUSH requires explicit --approve-push human approval.");
  const branch = run("git", ["branch", "--show-current"]);
  const tracked = run("git", ["diff", "--name-only"]);
  const staged = run("git", ["diff", "--cached", "--name-only"]);
  const upstream = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!branch.ok || !branch.output) fail("Unable to determine current branch.");
  if (!tracked.ok || tracked.output) fail("PUSH blocked: tracked working-tree changes are present.");
  if (!staged.ok || staged.output) fail("PUSH blocked: staged changes are present.");
  if (!upstream.ok) fail("PUSH blocked: no upstream branch configured.");
  if (branch.output === "main" || branch.output === "master") fail("PUSH blocked on protected default branch.");
  const result = run("git", ["push", "origin", branch.output]);
  if (!result.ok) fail(`git push failed: ${result.output}`);
  console.log(result.output || `Pushed ${branch.output}`);
  console.log("PUSH PASS — explicit human approval was supplied.");
  console.log("DEPLOY NOT PERFORMED.");
}

const mode = arg("--mode");
if (has("--help") || !mode) {
  console.log("Modes: verify | commit | push");
  console.log("VERIFY: --mode verify");
  console.log("COMMIT: --mode commit --files <file1,file2> --message <msg> --approve-commit");
  console.log("PUSH: --mode push --approve-push");
  process.exit(mode ? 0 : 1);
}

if (mode === "verify") verify();
else if (mode === "commit") commit();
else if (mode === "push") push();
else fail(`Unknown mode: ${mode}`);
