#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);

function arg(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function run(command, commandArgs = []) {
  try {
    const windowsShellCommand = process.platform === "win32" && (command === "npm.cmd" || command === "vercel");
    const executable = windowsShellCommand ? "cmd.exe" : command;
    const executableArgs = windowsShellCommand
      ? ["/d", "/s", "/c", `${command} ${commandArgs.join(" ")}`]
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
      output: error.stderr?.toString().trim()
        || error.stdout?.toString().trim()
        || error.message,
    };
  }
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function parseLimit() {
  const raw = Number.parseInt(arg("--limit", "20"), 10);
  if (!Number.isInteger(raw) || raw < 1 || raw > 100) {
    fail("--limit must be an integer from 1 to 100.");
  }
  return raw;
}

function gitHistory(limit, since) {
  const format = "%H%x1f%h%x1f%aI%x1f%an%x1f%s%x1e";
  const gitArgs = ["log", `-${limit}`, `--format=${format}`];
  if (since) gitArgs.push(`--since=${since}`);
  const result = run("git", gitArgs);
  if (!result.ok) fail(`Unable to read Git history: ${result.output}`);

  return result.output
    .split("\x1e")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [sha, shortSha, date, author, subject] = row.split("\x1f");
      return { sha, shortSha, date, author, subject };
    });
}

function productionHistory(limit) {
  const result = run("vercel", ["ls", "wos-platform-updated", "--json"]);
  if (!result.ok) {
    return { ok: false, error: result.output, deployments: [] };
  }

  try {
    const parsed = JSON.parse(result.output);
    const deployments = Array.isArray(parsed.deployments) ? parsed.deployments : [];
    return {
      ok: true,
      deployments: deployments
        .filter((item) => item?.target === "production")
        .slice(0, limit)
        .map((item) => ({
          url: item.url,
          state: item.state,
          target: item.target,
          createdAt: item.createdAt
            ? new Date(item.createdAt).toISOString()
            : null,
          readyAt: item.ready
            ? new Date(item.ready).toISOString()
            : null,
          commitSha: item.meta?.githubCommitSha || null,
          commitRef: item.meta?.githubCommitRef || null,
          commitMessage: item.meta?.githubCommitMessage || null,
          action: item.meta?.action || null,
        })),
    };
  } catch {
    return {
      ok: false,
      error: "Vercel returned non-JSON deployment history.",
      deployments: [],
    };
  }
}

const limit = parseLimit();
const since = arg("--since");
const json = hasFlag("--json");
const branch = run("git", ["branch", "--show-current"]);
const head = run("git", ["rev-parse", "HEAD"]);
const remote = run("git", ["rev-parse", "origin/feat/ai-core-v1"]);
const upstream = run("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
const status = run("git", ["status", "--short"]);
const history = gitHistory(limit, since);
const deployments = productionHistory(limit);

const audit = {
  generatedAt: new Date().toISOString(),
  branch: branch.output || null,
  head: head.output || null,
  remoteHead: remote.output || null,
  upstream: upstream.output || null,
  workingTree: status.output || "clean",
  gitHistory: history,
  productionHistory: deployments.deployments,
  productionHistoryAvailable: deployments.ok,
  productionHistoryError: deployments.ok ? null : deployments.error,
  safety: {
    readOnly: true,
    secretsPrinted: false,
    deployPerformed: false,
    rollbackPerformed: false,
    recoveryPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
  },
};

if (json) {
  console.log(JSON.stringify(audit, null, 2));
  process.exit(0);
}

console.log("WOS AI Dev Agent Audit / History");
console.log("");
console.log(`Generated: ${audit.generatedAt}`);
console.log(`Branch: ${audit.branch || "unknown"}`);
console.log(`HEAD: ${audit.head || "unknown"}`);
console.log(`Remote HEAD: ${audit.remoteHead || "unknown"}`);
console.log(`Upstream: ${audit.upstream || "unknown"}`);
console.log(`Working tree: ${audit.workingTree}`);
console.log("");
console.log(`Git history (${history.length} entries):`);
for (const item of history) {
  console.log(`- ${item.shortSha} | ${item.date} | ${item.subject}`);
}
console.log("");
if (deployments.ok) {
  console.log(`Production deployment history (${deployments.deployments.length} entries):`);
  for (const item of deployments.deployments) {
    console.log(
      `- ${item.createdAt || "unknown"} | ${item.state || "unknown"} | ${item.commitSha || "no commit"} | ${item.commitMessage || "no message"}`
    );
  }
} else {
  console.log(`Production deployment history: REVIEW REQUIRED — ${deployments.error}`);
}
console.log("");
console.log("Safety:");
console.log("- Read-only: YES");
console.log("- Secrets printed: NO");
console.log("- Commit/push/deploy/rollback/recovery: NOT PERFORMED");
