// Test / Evidence Gate. The checks are fixed here — the LLM cannot choose or weaken them.
// Every patch must be followed by: git diff --check, typecheck, unit tests, AI regression.
import { existsSync } from "node:fs";
import path from "node:path";

const clip = (s, n = 6000) => (s.length > n ? `${s.slice(0, n / 2)}\n...[clipped]...\n${s.slice(-n / 2)}` : s);

export function parseTsc(output) {
  const ids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/);
    if (m) ids.add(`${m[1].replace(/\\/g, "/")}::${m[4]}::${m[5].slice(0, 120)}`); // no line numbers: stable when code shifts
  }
  return [...ids];
}

export function parseVitestJson(stdout, rootDir = "") {
  const a = stdout.indexOf("{"), b = stdout.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const j = JSON.parse(stdout.slice(a, b + 1));
    const ids = [];
    for (const f of j.testResults ?? []) {
      const file = path.relative(rootDir, f.name ?? "").replace(/\\/g, "/") || f.name;
      const failed = (f.assertionResults ?? []).filter((t) => t.status === "failed");
      for (const t of failed) ids.push(`${file}::${t.fullName ?? t.title}`);
      if (f.status === "failed" && failed.length === 0) ids.push(`${file}::SUITE_ERROR`);
    }
    return { ids, total: j.numTotalTests ?? 0, failed: j.numFailedTests ?? 0 };
  } catch { return null; }
}

export function parseRegression(output, status) {
  // Real format of ai-regression-test.mjs:  "[T1j_province_continuation_priority] label ... FAIL - reason"
  const ids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^\[([^\]]+)\].*?\.\.\.\s*FAIL\b/);
    if (m) ids.add(`regression::${m[1]}`);
  }
  if (/Test runner crashed/.test(output)) ids.add("regression::runner_crashed");
  if (status !== 0 && ids.size === 0) ids.add(`regression::exit_${status}`);
  return [...ids];
}

export function regressionEnvBroken(output) {
  const fails = [...String(output).matchAll(/^\[[^\]]+\].*?\.\.\.\s*FAIL\s*-\s*(.*)$/gm)].map((m) => m[1]);
  if (fails.length >= 3) {
    const infra = fails.filter((f) => /request failed|fetch failed|ECONNREFUSED|ECONNRESET|HTTP (5\d\d|429|401|403|404)/i.test(f));
    if (infra.length / fails.length >= 0.8) return `${infra.length}/${fails.length} regression cases failed with request/HTTP errors (e.g. "${infra[0].slice(0, 90)}"): the dev server or AI gateway is probably not reachable - this is not a code bug`;
  }
  if (/Test runner crashed/.test(output)) return "the regression runner crashed";
  return "";
}

export function parseDiffCheck(output) {
  const ids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^(.+?):(\d+):\s*(.*)$/);
    if (m) ids.add(`diffcheck::${m[1]}::${m[3]}`);
  }
  return [...ids];
}

/**
 * runGate(guard, {deadline, perCheckMs, skipRegression, regressionFile, baseUrl, baselineDiffIds})
 * returns { ok, score, signature, checks:[{name,status,failures,summary}], missingRequired }
 */
export function runGate(guard, opts = {}) {
  const { build = false, captureBaseline = false, deadline = Infinity, perCheckMs = 15 * 60_000, skipRegression = false, regressionFile = "ai-regression-test.mjs", baseUrl, baselineDiffIds = new Set(), tsconfig } = opts;
  const budget = () => Math.max(1000, Math.min(perCheckMs, deadline - Date.now()));
  const checks = [];
  const add = (name, status, failures = [], summary = "") => checks.push({ name, status, failures, summary: clip(summary) });

  // 1) git diff --check (only NEW whitespace problems count; pre-existing ones are baseline)
  {
    const r = guard.exec("git", ["diff", "--check"], { timeoutMs: budget() });
    const ids = r.ok || captureBaseline ? [] : parseDiffCheck(r.output).filter((id) => !baselineDiffIds.has(id));
    add("diff-check", ids.length ? "FAIL" : "PASS", ids, ids.length ? r.output : "");
    checks[0].allIds = r.ok ? [] : parseDiffCheck(r.output);
  }

  // 2) typecheck
  let typecheckFailed = false;
  {
    const args = ["tsc", "--noEmit", "--pretty", "false", ...(tsconfig ? ["-p", tsconfig] : [])];
    const r = guard.exec("npx", args, { timeoutMs: budget() });
    if (r.denied || r.error) add("typecheck", "ERROR", ["typecheck::could_not_run"], r.output || r.error);
    else {
      const ids = parseTsc(r.output);
      const status = r.ok ? "PASS" : "FAIL";
      typecheckFailed = !r.ok;
      add("typecheck", status, r.ok ? [] : ids.length ? ids : [`typecheck::exit_${r.status}`], r.ok ? "" : r.output);
    }
  }

  // 3) unit tests
  {
    const r = guard.exec("npx", ["vitest", "run", "--reporter=json"], { timeoutMs: budget() });
    if (r.denied || r.error) add("unit", "ERROR", ["unit::could_not_run"], r.output || r.error);
    else {
      const parsed = parseVitestJson(r.stdout, guard.root);
      const ids = r.ok ? [] : parsed?.ids?.length ? parsed.ids : [`unit::exit_${r.status}`];
      add("unit", r.ok ? "PASS" : "FAIL", ids, r.ok ? `${parsed?.total ?? "?"} tests` : r.output);
    }
  }

  // 4) AI regression (real behavioural check; required unless explicitly skipped)
  if (skipRegression) add("regression", "SKIPPED", [], "skipped by --skip-regression");
  else if (!existsSync(path.resolve(guard.root, regressionFile))) add("regression", "MISSING", ["regression::file_missing"], `${regressionFile} not found`);
  else if (typecheckFailed) add("regression", "NOT_RUN", [], "typecheck failed; regression not meaningful");
  else {
    const args = [regressionFile, ...(baseUrl ? ["--base-url", baseUrl] : [])];
    const r = guard.exec("node", args, { timeoutMs: budget() });
    if (r.denied || r.timedOut) add("regression", "ERROR", ["regression::could_not_run"], r.output);
    else {
      const env = r.ok ? "" : regressionEnvBroken(r.output);
      if (env) add("regression", "ENV_ERROR", ["regression::environment_unreachable"], `${env}\n${r.output.slice(0, 1500)}`);
      else add("regression", r.ok ? "PASS" : "FAIL", r.ok ? [] : parseRegression(r.output, r.status), r.ok ? "" : r.output);
    }
  }

  // 5) build (optional, slow): proves the app still compiles for production
  if (build) {
    if (typecheckFailed) add("build", "NOT_RUN", [], "typecheck failed; build not meaningful");
    else {
      const r = guard.exec("npm", ["run", "build"], { timeoutMs: budget() });
      add("build", r.ok ? "PASS" : r.denied ? "ERROR" : "FAIL", r.ok ? [] : [`build::${r.denied ? "not_allowed" : `exit_${r.status}`}`], r.ok ? "" : r.output);
    }
  }

  const required = ["diff-check", "typecheck", "unit", ...(skipRegression ? [] : ["regression"]), ...(build ? ["build"] : [])];
  const failing = checks.filter((c) => required.includes(c.name) && c.status !== "PASS");
  const allFailures = failing.flatMap((c) => c.failures.length ? c.failures : [`${c.name}::${c.status}`]);
  return {
    ok: failing.length === 0,
    score: allFailures.length,
    signature: [...new Set(allFailures)].sort().join("\n"),
    failures: [...new Set(allFailures)].sort(),
    checks,
    diffCheckAllIds: new Set(checks[0].allIds ?? []),
    skippedRegression: skipRegression,
  };
}

export function summarizeGate(g) {
  return g.checks.map((c) => `${c.name}: ${c.status}${c.failures.length ? ` (${c.failures.length})` : ""}`).join(" | ");
}
