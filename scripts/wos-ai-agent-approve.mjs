#!/usr/bin/env node
// Human-approved commit of EXACTLY what the agent reported (npm run ai:agent:commit -- --message "...").
// Not reachable by the agent loop (it is not on the guard allowlist). Never pushes, never deploys.
// The existing protected gate adds Telegram approval and the git-gate's explicit-file-list rules.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function verifyReport(report, root = process.cwd()) {
  const problems = [];
  if (!report || report.status !== "PASS" || !report.awaitingApproval) problems.push("report is not a PASS awaiting approval");
  if (!Array.isArray(report?.files) || report.files.length === 0) problems.push("report lists no changed files");
  for (const f of report?.files ?? []) {
    const abs = path.resolve(root, f.path);
    if (!abs.startsWith(path.resolve(root) + path.sep)) { problems.push(`path escapes repository: ${f.path}`); continue; }
    if (!existsSync(abs)) { problems.push(`file missing: ${f.path}`); continue; }
    const now = createHash("sha256").update(readFileSync(abs, "utf8")).digest("hex");
    if (now !== f.sha256) problems.push(`file changed since the agent reported it: ${f.path} (review it again, or re-run the agent)`);
  }
  return problems;
}

export function latestReport(root = process.cwd(), run) {
  const base = path.resolve(root, ".overnight");
  if (!existsSync(base)) return null;
  const dirs = run ? [run] : readdirSync(base).sort().reverse();
  for (const d of dirs) {
    const p = path.join(base, d, "report.json");
    if (existsSync(p)) { const r = JSON.parse(readFileSync(p, "utf8")); if (run || r.awaitingApproval) return { dir: d, report: r }; }
  }
  return null;
}

function cli() {
  const argv = process.argv.slice(2);
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const message = val("--message");
  if (!message || message.startsWith("--")) { console.error('Usage: npm run ai:agent:commit -- --message "<commit message>" [--run <folder name in .overnight>]'); process.exit(1); }
  const found = latestReport(process.cwd(), val("--run"));
  if (!found) { console.error("No agent report awaiting approval found in .overnight/."); process.exit(1); }
  const problems = verifyReport(found.report);
  if (problems.length) { console.error("Refusing to commit:\n- " + problems.join("\n- ")); process.exit(1); }
  const files = found.report.files.map((f) => f.path);
  console.log(`Run: ${found.dir}\nTask: ${found.report.task}\nFiles to commit (explicit list):\n${files.map((f) => `  - ${f}`).join("\n")}\nPush: NOT performed. Deploy: NOT performed.\n`);
  const r = spawnSync(process.execPath, ["scripts/wos-ai-agent-protected.mjs", "commit", "--files", files.join(","), "--message", message], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) cli();
