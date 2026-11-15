import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { askValidated as auditAskValidated } from "./llm.mjs";
import { inspectText, isSafePatch, safeJson, WITHHELD } from "./sanitize.mjs";
import { publishRun } from "./cli.mjs";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGuard, parseDuration, scrub } from "./guard.mjs";
import { parseTsc, parseVitestJson, parseDiffCheck } from "./gate.mjs";
import { supervise, formatReport } from "./supervisor.mjs";

function repo(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ovn-"));
  const sh = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  sh("init", "-q", "-b", "ai/test"); sh("config", "user.email", "t@t"); sh("config", "user.name", "t");
  const base = { "src/lib/ai/understand.ts": "export const v = 1;\n", "src/lib/ai/understand.test.ts": "// test\n", ".env.local": "X=1\n", "package.json": "{}\n", "sql/001.sql": "--\n", ...files };
  for (const [f, c] of Object.entries(base)) { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), c); }
  sh("add", "-A"); sh("commit", "-qm", "init");
  return dir;
}

test("guard: forbidden commands are denied", () => {
  const g = createGuard({ root: repo() });
  const bad = [["git", ["add", "."]], ["git", ["commit", "-m", "x"]], ["git", ["push"]], ["git", ["push", "--force"]], ["git", ["reset", "--hard"]], ["git", ["checkout", "."]],
    ["git", ["stash"]], ["git", ["branch", "-D", "x"]], ["vercel", ["deploy", "--prod"]], ["npm", ["install"]], ["npm", ["run", "production:deploy"]], ["node", ["-e", "1"]],
    ["node", ["scripts/production-deploy.mjs"]], ["curl", ["http://x"]], ["rm", ["-rf", "."]], ["npx", ["vitest", "run", "-u"]], ["npx", ["vitest"]], ["npx", ["supabase", "db", "push"]], ["bash", ["-c", "git push"]], ["powershell", ["-c", "x"]]];
  for (const [c, a] of bad) assert.equal(g.checkCommand(c, a).allowed, false, `${c} ${a.join(" ")}`);
  assert.ok(g.violations.length >= bad.length);
});

test("guard: gate commands and read-only git are allowed", () => {
  const g = createGuard({ root: repo() });
  for (const [c, a] of [["git", ["status", "--short"]], ["git", ["diff", "--check"]], ["git", ["rev-parse", "HEAD"]], ["git", ["branch", "--show-current"]], ["git", ["diff", "--cached", "--name-only"]],
    ["npx", ["tsc", "--noEmit"]], ["npx", ["vitest", "run", "--reporter=json"]], ["node", ["ai-regression-test.mjs", "--base-url", "http://localhost:3000"]]])
    assert.equal(g.checkCommand(c, a).allowed, true, `${c} ${a.join(" ")}`);
});

test("guard: exec refuses git commit for real and repo is unchanged", () => {
  const dir = repo(); const g = createGuard({ root: dir });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString();
  const r = g.exec("git", ["commit", "--allow-empty", "-m", "x"]);
  assert.equal(r.denied, true);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString(), head);
});

test("guard: write rules", () => {
  const g = createGuard({ root: repo() });
  const no = [".env.local", "sql/001.sql", "package.json", "scripts/overnight/guard.mjs", "scripts/wos-ai-agent.mjs", "src/lib/ai/core.ts.backup-x", "../evil.ts", "/etc/passwd",
    "src/app/page.tsx", "src/lib/ai/understand.test.ts", "supabase/migrations/1.sql", "src/lib/ai/production-thing.ts", ".git/config", "src/lib/ai/x.exe"];
  for (const p of no) assert.equal(g.checkWrite(p).allowed, false, p);
  assert.equal(g.checkWrite("src/lib/ai/understand.ts").allowed, true);
  assert.equal(g.checkWrite("src/lib/ai/new.test.ts", { creating: true }).allowed, true);
  assert.equal(createGuard({ root: repo(), allowTestEdits: true }).checkWrite("src/lib/ai/understand.test.ts").allowed, true);
});

test("guard: applyEdits is atomic, exact-match, and blocks secrets", () => {
  const dir = repo(); const g = createGuard({ root: dir });
  assert.throws(() => g.applyEdits([{ file: "src/lib/ai/understand.ts", old: "v = 1", new: "v = 2" }, { file: ".env.local", old: "X=1", new: "X=2" }]));
  assert.equal(readFileSync(path.join(dir, "src/lib/ai/understand.ts"), "utf8"), "export const v = 1;\n"); // nothing written
  assert.throws(() => g.applyEdits([{ file: "src/lib/ai/understand.ts", old: "nope", new: "x" }]), /found 0/);
  assert.throws(() => g.applyEdits([{ file: "src/lib/ai/understand.ts", old: "v = 1", new: "k = 'SUPABASE_SERVICE_ROLE_KEY=abcdefghijklmnop'" }]), /secret/);
  g.applyEdits([{ file: "src/lib/ai/understand.ts", old: "v = 1", new: "v = 2" }]);
  assert.equal(readFileSync(path.join(dir, "src/lib/ai/understand.ts"), "utf8"), "export const v = 2;\n");
});

test("helpers: duration, scrub, parsers", () => {
  assert.equal(parseDuration("6h"), 21_600_000); assert.equal(parseDuration("1h30m"), 5_400_000); assert.equal(parseDuration("45"), 2_700_000);
  assert.throws(() => parseDuration("soon"));
  const fakeApiKey = "sk-" + "abcdefghijklmnopqrstuvwxyz123";
  assert.ok(!scrub("OPENAI_API_KEY=" + fakeApiKey).includes("abcdefgh"));
  assert.deepEqual(parseTsc("src/a.ts(10,5): error TS2322: Type 'x' is not assignable."), ["src/a.ts::TS2322::Type 'x' is not assignable."]);
  const j = JSON.stringify({ numTotalTests: 2, numFailedTests: 1, testResults: [{ name: "/r/src/a.test.ts", status: "failed", assertionResults: [{ status: "failed", fullName: "a b" }, { status: "passed", fullName: "ok" }] }] });
  assert.deepEqual(parseVitestJson("noise\n" + j + "\n", "/r").ids, ["src/a.test.ts::a b"]);
  assert.deepEqual(parseDiffCheck("a.ts:3: trailing whitespace.\n+x"), ["diffcheck::a.ts::trailing whitespace."]);
});

// ---- supervisor with fake brain + fake gate (file content decides the "test result") ----
const mkGate = (dir) => () => {
  const v = readFileSync(path.join(dir, "src/lib/ai/understand.ts"), "utf8");
  const failures = v.includes("v = 3") ? [] : v.includes("v = 2") ? ["t::b"] : ["t::a", "t::b"];
  return { ok: failures.length === 0, score: failures.length, signature: failures.join("\n"), failures, diffCheckAllIds: new Set(), checks: [{ name: "typecheck", status: "PASS", failures: [], summary: "" }, { name: "unit", status: failures.length ? "FAIL" : "PASS", failures, summary: failures.join() }] };
};
const edit = (a, b) => ({ edits: [{ file: "src/lib/ai/understand.ts", old: a, new: b }], rationale: "r" });
const brain = (patches, calls = { diag: 0 }) => {
  let i = 0;
  return { calls, planner: async () => ({ rootCause: "x".repeat(50) }), diagnoser: async () => { calls.diag++; return { diagnosis: "because" }; },
    patcher: async () => { const p = patches[Math.min(i++, patches.length - 1)]; if (p instanceof Error) throw p; return p; } };
};

test("supervisor: PASS after improving iterations, nothing committed", async () => {
  const dir = repo(); const guard = createGuard({ root: dir });
  const r = await supervise({ task: "t", guard, gate: mkGate(dir), ...brain([edit("v = 1", "v = 2"), edit("v = 2", "v = 3")]), opts: { gate: {} } });
  assert.equal(r.status, "PASS"); assert.equal(r.iterationCount, 2); assert.deepEqual(r.filesChanged, ["src/lib/ai/understand.ts"]);
  assert.equal(r.commit, "NONE"); assert.match(formatReport(r), /Commit: NONE[\s\S]*Push: NONE[\s\S]*Deploy: NONE[\s\S]*READY FOR HUMAN REVIEW/);
  assert.equal(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dir }).toString().trim(), "");
});

test("supervisor: no improvement -> BLOCKED and tree restored to best state", async () => {
  const dir = repo(); const guard = createGuard({ root: dir });
  const r = await supervise({ task: "t", guard, gate: mkGate(dir), ...brain([edit("v = 1", "v = 2"), edit("v = 2", "v = 2.5"), edit("v = 2.5", "v = 2.6")]), opts: { noImproveLimit: 2, gate: {} } });
  assert.equal(r.status, "BLOCKED"); assert.match(r.reason, /NO_IMPROVEMENT/);
  assert.equal(readFileSync(path.join(dir, "src/lib/ai/understand.ts"), "utf8"), "export const v = 2;\n"); // best (1 failure), not last
});

test("supervisor: worse patch is rolled back before next attempt", async () => {
  const dir = repo(); const guard = createGuard({ root: dir });
  const worse = (a) => edit(a, "v = 9; // breaks");
  const r = await supervise({ task: "t", guard, gate: (g) => { const x = mkGate(dir)(g); return readFileSync(path.join(dir, "src/lib/ai/understand.ts"), "utf8").includes("breaks") ? { ...x, score: 5, signature: "worse", failures: ["a", "b", "c", "d", "e"] } : x; }, ...brain([edit("v = 1", "v = 2"), worse("v = 2")]), opts: { noImproveLimit: 5, maxIterations: 2, gate: {} } });
  assert.equal(r.iterations[1].progress, "worse");
  assert.equal(readFileSync(path.join(dir, "src/lib/ai/understand.ts"), "utf8"), "export const v = 2;\n");
});

test("supervisor: failure limit (guard-rejected patches)", async () => {
  const dir = repo(); const guard = createGuard({ root: dir });
  const r = await supervise({ task: "t", guard, gate: mkGate(dir), ...brain([{ edits: [{ file: ".env.local", old: "X=1", new: "X=2" }] }]), opts: { failureLimit: 3, gate: {} } });
  assert.equal(r.status, "BLOCKED"); assert.match(r.reason, /FAILURE_LIMIT/); assert.equal(r.iterationCount, 3);
  assert.equal(readFileSync(path.join(dir, ".env.local"), "utf8"), "X=1\n"); assert.ok(r.guardViolations.length >= 3);
});

test("supervisor: max iterations", async () => {
  const dir = repo(); const guard = createGuard({ root: dir });
  const r = await supervise({ task: "t", guard, gate: mkGate(dir), ...brain([edit("v = 1", "v = 1 ")]), opts: { maxIterations: 1, gate: {} } });
  assert.equal(r.status, "BLOCKED"); assert.match(r.reason, /MAX_ITERATIONS|NO_IMPROVEMENT/);
});

test("supervisor: timeout via fake clock", async () => {
  const dir = repo(); const guard = createGuard({ root: dir }); let t = 0;
  const b = brain([edit("v = 1", "v = 2")]); const patcher = b.patcher; b.patcher = async (x) => { t += 10_000; return patcher(x); };
  const r = await supervise({ task: "t", guard, gate: mkGate(dir), ...b, now: () => t, opts: { timeoutMs: 5_000, gate: {} } });
  assert.equal(r.status, "TIMEOUT");
});

test("supervisor: never patches without a diagnosis", async () => {
  const dir = repo(); const guard = createGuard({ root: dir }); let patched = 0;
  const r = await supervise({ task: "t", guard, gate: mkGate(dir), planner: async () => ({ rootCause: "x".repeat(50) }), diagnoser: async () => ({ diagnosis: "  " }), patcher: async () => { patched++; return edit("v = 1", "v = 3"); }, opts: { failureLimit: 2, gate: {} } });
  assert.equal(patched, 0); assert.equal(r.status, "BLOCKED");
});

test("supervisor: green baseline is BLOCKED (no failing evidence)", async () => {
  const dir = repo({ "src/lib/ai/understand.ts": "export const v = 3;\n" }); const guard = createGuard({ root: dir });
  const r = await supervise({ task: "t", guard, gate: mkGate(dir), ...brain([edit("v = 3", "v = 4")]), opts: { gate: {} } });
  assert.equal(r.status, "BLOCKED"); assert.match(r.reason, /NO_FAILING_EVIDENCE/); assert.equal(r.iterationCount, 0);
});

test("gate: parses the real ai-regression-test.mjs output format", async () => {
  const { parseRegression } = await import("./gate.mjs");
  const out = "[T1a_x] label ... PASS\n[T1j_province_continuation_priority] Province answer ... FAIL - province continuation incorrectly jumped\n[T1l_program_discovery_exact_phrases] x ... FAIL - y\nREGRESSION DETECTED";
  assert.deepEqual(parseRegression(out, 1), ["regression::T1j_province_continuation_priority", "regression::T1l_program_discovery_exact_phrases"]);
  assert.deepEqual(parseRegression("boom", 1), ["regression::exit_1"]);
});

test("report lists baseline failures when not PASS", () => {
  const r = { status: "BLOCKED", task: "t", reason: "x", iterationCount: 0, durationMs: 1000, filesChanged: [], commit: "NONE", push: "NONE", deploy: "NONE", guardViolations: [],
    baseline: { failures: ["a.test.ts::case one", "typecheck::TS1"] }, final: { checks: [] } };
  assert.match(formatReport(r), /Baseline failures \(2[\s\S]*a\.test\.ts::case one/);
});

test("llm: schema-echo is rejected and the model is asked again with feedback", async () => {
  const { makeLlm } = await import("./llm.mjs");
  const dir = repo(); const guard = createGuard({ root: dir });
  const echo = { rootCause: "concrete mechanism citing file+symbol", filesToInspect: ["path"], proposedChanges: ["string"], confidence: 0 };
  const good = { rootCause: "detectProvinceInText only accepts the dotted marker 'à¸ˆ.' via MARKER_PREFIXES, so 'à¸ˆ à¸•à¸²à¸' is never matched.", filesToInspect: ["src/lib/ai/understand.ts"], proposedChanges: ["add undotted marker"], confidence: 0.8 };
  const seen = [];
  const ask = async (messages) => { seen.push(messages.length); const j = seen.length === 1 ? echo : good; return { text: JSON.stringify(j), json: structuredClone(j) }; };
  const llm = makeLlm({ guard, ask });
  const plan = await llm.planner({ task: "t", baseline: { failures: [] }, timeLeft: 60000 });
  assert.equal(seen.length, 2); assert.equal(seen[1], 4); assert.match(plan.rootCause, /MARKER_PREFIXES/);
  const alwaysEcho = makeLlm({ guard, ask: async () => ({ text: JSON.stringify(echo), json: structuredClone(echo) }) });
  await assert.rejects(alwaysEcho.planner({ task: "t", baseline: { failures: [] }, timeLeft: 60000 }), /rootCause is missing, a placeholder/);
  const badPatch = makeLlm({ guard, ask: async () => ({ text: "{}", json: { edits: [{ file: "path", old: "exact existing text, unique in file", new: "replacement" }] } }) });
  await assert.rejects(badPatch.patcher({ task: "t", plan: {}, diagnosis: { diagnosis: "x" }, gate: { failures: [] }, history: [], timeLeft: 60000 }), /placeholder/);
});

test("llm: transient gateway errors (Cloudflare 524) are retried with backoff, real errors are not", async () => {
  const { withRetry, isRetryable } = await import("./llm.mjs");
  const waits = []; let n = 0;
  const ok = await withRetry(async () => { if (++n < 3) throw Object.assign(new Error("524 timeout"), { status: 524 }); return "done"; }, { sleep: async (ms) => waits.push(ms) });
  assert.equal(ok, "done"); assert.deepEqual(waits, [20000, 40000]);
  let m = 0;
  await assert.rejects(withRetry(async () => { m++; throw Object.assign(new Error("bad key"), { status: 401 }); }, { sleep: async () => {} }), /bad key/);
  assert.equal(m, 1); assert.equal(isRetryable({ status: 524 }), true); assert.equal(isRetryable({ status: 401 }), false);
  await assert.rejects(withRetry(async () => { throw Object.assign(new Error("x"), { status: 524 }); }, { sleep: async () => {}, timeLeft: () => 1000 }), /x/); // no time left -> give up
});

test("llm: --focus sends only the listed files and respects the context cap", async () => {
  const { makeLlm } = await import("./llm.mjs");
  const big = "export const filler = 1;\n".repeat(4000);
  const dir = repo({ "src/lib/ai/big.ts": big, "src/lib/ai/understand.ts": "export const target = 1;\n" });
  const guard = createGuard({ root: dir }); const prompts = [];
  const plan = { rootCause: "x".repeat(60), filesToInspect: [], proposedChanges: [], confidence: 1 };
  const llm = makeLlm({ guard, focus: true, maxContextKb: 4, extraFiles: ["src/lib/ai/understand.ts"], ask: async (m) => { prompts.push(m[1].content); return { text: "{}", json: structuredClone(plan) }; } });
  await llm.planner({ task: "target", baseline: { failures: ["src/lib/ai/big.ts::case"] }, timeLeft: 60000 });
  assert.match(prompts[0], /===== src\/lib\/ai\/understand\.ts =====/);
  assert.ok(prompts[0].length < 9000, `prompt too large: ${prompts[0].length}`);
});

// ================= contract mode: reproduce-first, layers, hard-code guard, Definition of Done =================
const PROV = "src/lib/ai/understanding/provinces.ts", GATE = "src/lib/ai/understanding/gate.ts", REPRO = "src/lib/ai/understanding/udon.agent-repro.test.ts", USERTEST = "src/lib/ai/understanding/x.test.ts";
const repoC = (extra = {}) => repo({ [PROV]: "export const v = 1;\n", [GATE]: "export const g = 1;\n", ...extra });
const read = (dir, f) => readFileSync(path.join(dir, f), "utf8");
// fake gate: the "target" test (repro file or user test) fails until provinces.ts contains "v = 2"
const gateC = (dir, target) => () => {
  const fixed = read(dir, PROV).includes("v = 2");
  const t = target ?? (existsSync(path.join(dir, REPRO)) ? REPRO : null);
  const failures = t && !fixed ? [`${t}::case`] : [];
  const mk = (name, st, f = []) => ({ name, status: st, failures: f, summary: "" });
  return { ok: failures.length === 0, score: failures.length, signature: failures.join(), failures, diffCheckAllIds: new Set(),
    checks: [mk("diff-check", "PASS"), mk("typecheck", "PASS"), mk("unit", failures.length ? "FAIL" : "PASS", failures), mk("regression", "PASS")] };
};
const plan = (o = {}) => ({ rootCause: "provinces.ts constant v is 1 so the marker is never recognised by detectProvinceInText", layers: ["understanding"], evidence: [{ file: PROV, symbol: "v = 1" }], ...o });
const brainC = ({ planObj = plan(), patches, reproducer, planner } = {}) => {
  let i = 0;
  return { planner: planner ?? (async () => planObj), diagnoser: async () => ({ diagnosis: "because v is 1" }),
    patcher: async () => { const p = patches[Math.min(i++, patches.length - 1)]; return typeof p === "function" ? p() : p; },
    reproducer: reproducer ?? (async () => ({ file: REPRO, content: "import {it,expect} from 'vitest';\nit('x',()=>{expect(1).toBe(2)});\n" })) };
};
const fix = { edits: [{ file: PROV, old: "v = 1", new: "v = 2" }], rationale: "r" };
const C = { contract: true, reproduce: true, gate: {} };

test("supervisor: gate exception after a patch blocks and restores the baseline", async () => {
  const dir = repoC();
  const guard = createGuard({ root: dir });
  const secret = "sk-" + "g".repeat(24);
  let gateCalls = 0;
  const gate = () => {
    if (++gateCalls === 1) return gateC(dir, REPRO)();
    assert.equal(read(dir, PROV), "export const v = 2;\n", "the patch must be present when the post-patch gate runs");
    throw new Error(`fixture gate failed API_KEY=${secret}`);
  };
  const result = await supervise({ task: "t", guard, gate, ...brainC({ patches: [fix] }), opts: C });
  assert.equal(gateCalls, 2);
  assert.equal(result.status, "BLOCKED");
  assert.match(result.reason, /GATE_ERROR/);
  assert.match(result.reason, /API_KEY=\[REDACTED\]/);
  assert.ok(!JSON.stringify(result).includes(secret), "gate exception credential must be redacted");
  assert.equal(read(dir, PROV), "export const v = 1;\n", "the production file must be restored to its pre-patch content");
  assert.deepEqual(result.filesChanged, []);
  assert.equal(result.commit, "NONE");
  assert.equal(result.push, "NONE");
  assert.equal(result.deploy, "NONE");
});
test("contract: green baseline -> writes a failing repro test first, fixes, DoD green, waits for approval", async () => {
  const dir = repoC(); const guard = createGuard({ root: dir });
  const r = await supervise({ task: "t", guard, gate: gateC(dir), ...brainC({ patches: [fix] }), opts: C });
  assert.equal(r.status, "PASS", r.reason); assert.equal(r.reproFile, REPRO); assert.equal(r.awaitingApproval, true);
  assert.ok(existsSync(path.join(dir, REPRO))); assert.ok(r.dod.every((d) => d.state !== "fail"), JSON.stringify(r.dod));
  assert.equal(r.dod.find((d) => d.id === "build").state, "skipped");
  assert.deepEqual(r.files.map((f) => f.path).sort(), [PROV, REPRO].sort()); assert.equal(r.files.find((f) => f.path === REPRO).created, true);
  assert.match(formatReport(r), /Definition of Done:[\s\S]*\[âœ“\] Root cause proven[\s\S]*\[âš \] Build passes[\s\S]*WAITING FOR APPROVAL/);
  assert.equal(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dir }).toString().trim(), "");
});

test("contract: rejected repro attempts retain source, per-check evidence, and feedback", async () => {
  const dir = repoC(); const artifactsDir = path.join(dir, "run-artifacts");
  const mk = (name, status, failures = [], summary = "") => ({ name, status, failures, summary });
  let gateCalls = 0;
  const detailedGate = () => {
    gateCalls++;
    if (gateCalls === 1) return gateC(dir)();
    const tscFailure = `${REPRO}::TS2345::Argument of type string is not assignable`;
    const unitFailure = `${REPRO}::province punctuation regression`;
    const failures = [tscFailure, unitFailure];
    return { ok: false, score: failures.length, signature: failures.join("\n"), failures, diffCheckAllIds: new Set(), checks: [
      mk("diff-check", "FAIL", ["diffcheck::trailing whitespace"], "whitespace diagnostic"),
      mk("typecheck", "FAIL", [tscFailure], `${REPRO}(4,12): error TS2345: Argument of type string is not assignable`),
      mk("unit", "FAIL", [unitFailure], "1 failed | 0 passed"),
      mk("regression", "ERROR", ["regression::could_not_run"], "regression diagnostic"),
      mk("build", "FAIL", ["build::exit_1"], "build diagnostic"),
    ] };
  };
  const feedbackSeen = [];
  const source = "import { it, expect } from 'vitest';\nit('repro', () => expect(1).toBe(2));\n";
  const r = await supervise({ task: "t", guard: createGuard({ root: dir }), gate: detailedGate,
    ...brainC({ patches: [fix], reproducer: async ({ feedback }) => { feedbackSeen.push(feedback); return { file: REPRO, content: source }; } }),
    artifactsDir, opts: C });
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.reproduceAttempts.length, 2);
  const first = r.reproduceAttempts[0];
  assert.equal(first.outcome, "REJECTED");
  assert.equal(first.rejectionReason, "TYPECHECK_FAILED_IN_REPRO_FILE");
  assert.deepEqual(first.unitFailuresInReproFile, [`${REPRO}::province punctuation regression`]);
  assert.ok(first.typecheckFailuresInReproFile[0].includes("TS2345"));
  assert.equal(first.feedbackSent, "");
  assert.equal(first.feedbackForNextAttempt, "the test file has a type error or fails for the wrong reason; fix the test itself");
  assert.deepEqual(first.gate.checks.map((check) => check.name), ["diff-check", "typecheck", "unit", "regression", "build"]);
  assert.equal(first.gate.ok, false);
  const untruncated = { omittedFailureCount: 0, truncatedFailureIdCount: 0, omittedSummaryCharacters: 0, truncated: false };
  assert.deepEqual(first.gate.checks[0], { ...mk("diff-check", "FAIL", ["diffcheck::trailing whitespace"], "whitespace diagnostic"), ...untruncated });
  assert.deepEqual(first.gate.checks[3], { ...mk("regression", "ERROR", ["regression::could_not_run"], "regression diagnostic"), ...untruncated });
  assert.deepEqual(first.gate.checks[4], { ...mk("build", "FAIL", ["build::exit_1"], "build diagnostic"), ...untruncated });
  assert.equal(r.reproduceAttempts[1].feedbackSent, first.feedbackForNextAttempt);
  assert.equal(feedbackSeen[1], first.feedbackForNextAttempt);
  assert.equal(first.sourceArtifact, "repro-attempt-01.test-source.txt");
  assert.equal(readFileSync(path.join(artifactsDir, first.sourceArtifact), "utf8"), source);
  assert.equal(first.sourceSha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(first.sourceBytes, Buffer.byteLength(source, "utf8"));
  assert.ok(!existsSync(path.join(dir, REPRO)), "rejected test must be removed from the worktree");
  assert.deepEqual(r.filesChanged, []);
  assert.match(formatReport(r), /Reproduction attempts:[\s\S]*TYPECHECK_FAILED_IN_REPRO_FILE/);
});
test("contract: reproduction diagnostics are bounded and redacted without changing gate or acceptance", async () => {
  const dir = repoC();
  const ordinaryGate = gateC(dir);
  const envSecret = "sk-" + "e".repeat(24);
  const bearerSecret = "fixture-bearer-value-c24d2";
  const failures = [
    "x".repeat(350),
    `external::${envSecret}`,
    ...Array.from({ length: 43 }, (_, index) => `external::case ${index}`),
    `${REPRO}::decisive failure beyond the report limit`,
  ];
  const summary = `Authorization: Bearer ${bearerSecret}\n${"s".repeat(3200)}`;
  const unit = { name: "unit", status: "FAIL", failures: Object.freeze(failures), summary };
  const typecheck = { name: "typecheck", status: "FAIL", failures: Object.freeze(["other.ts::TS1234"]), summary: "" };
  const rawGate = Object.freeze({
    ...ordinaryGate(), ok: false, score: failures.length + 1, signature: "fixture",
    failures: Object.freeze([...failures, ...typecheck.failures]),
    checks: Object.freeze([Object.freeze(unit), Object.freeze(typecheck)]),
  });
  const before = structuredClone(rawGate);
  {
    let calls = 0;
    const gate = () => ++calls === 2 ? rawGate : ordinaryGate();
    const result = await supervise({ task: "t", guard: createGuard({ root: dir }), gate,
      ...brainC({ patches: [fix] }), opts: C });
    assert.equal(result.status, "PASS", "fixture must pass");
    assert.equal(result.reproFile, REPRO);
    assert.equal(result.reproduceAttempts.length, 1);
    const attempt = result.reproduceAttempts[0];
    assert.equal(attempt.outcome, "REPRODUCED");
    assert.equal(attempt.gate.ok, false);
    assert.equal(attempt.gate.score, rawGate.score);
    const [check, other] = attempt.gate.checks;
    assert.equal(check.name, "unit");
    assert.equal(check.status, "FAIL");
    assert.equal(check.summary.length, 3000);
    assert.equal(check.omittedSummaryCharacters, "Authorization: Bearer [REDACTED]\n".length + 3200 - 3000);
    assert.equal(check.failures.length, 40);
    assert.equal(check.failures[0], "x".repeat(300));
    assert.ok(check.failures[1] === "external::sk-[REDACTED]", "failure ID must be redacted");
    assert.equal(check.omittedFailureCount, 6);
    assert.equal(check.truncatedFailureIdCount, 1);
    assert.equal(check.truncated, true);
    assert.deepEqual(other.failures, typecheck.failures);
    assert.equal(other.truncated, false);
    assert.deepEqual(attempt.unitFailuresInReproFile, [failures.at(-1)]);
    for (const secret of [envSecret, bearerSecret]) assert.ok(!JSON.stringify(attempt).includes(secret));
    assert.ok(isDeepStrictEqual(rawGate, before), "original gate changed");
  }
});

test("contract: reproduction exceptions are redacted in reports, logs, and retry feedback", async () => {
  const dir = repoC();
  const key = "sk-" + "a".repeat(24);
  const token = "fixture-bearer-22f8";
  const feedbackSeen = [];
  const logs = [];
  const result = await supervise({ task: "t", guard: createGuard({ root: dir }), gate: gateC(dir),
    ...brainC({ reproducer: async ({ feedback }) => {
      feedbackSeen.push(feedback);
      if (feedbackSeen.length === 1) throw new Error(`fixture failed API_KEY=${key}; Authorization: Bearer ${token}`);
      throw new Error("fixture retry failed");
    } }), log: (message) => logs.push(message), opts: C });
  const [first, second] = result.reproduceAttempts;
  const expected = "fixture failed API_KEY=[REDACTED]; Authorization: Bearer [REDACTED]";
  assert.ok(first.rejectionReason === expected, "rejection reason must be redacted");
  assert.ok(first.feedbackForNextAttempt === expected, "recorded retry feedback must be redacted");
  assert.ok(second.feedbackSent === expected, "recorded sent feedback must be redacted");
  assert.ok(feedbackSeen[1] === expected, "reproducer must receive redacted feedback");
  assert.ok(second.rejectionReason === "fixture retry failed", "safe retry error must remain visible");
  assert.ok(second.feedbackForNextAttempt === second.rejectionReason, "retry fallback must match rejection fallback");
  assert.ok(/CANNOT_REPRODUCE.*fixture retry failed/.test(result.reason), "stop reason must use fallback");
  for (const secret of [key, token]) {
    assert.ok(!JSON.stringify({ result, feedbackSeen, logs }).includes(secret), "synthetic secret leaked");
  }
});

test("contract: source artifact filesystem errors redact credentials in paths", async () => {
  const dir = repoC();
  const key = "sk-" + "b".repeat(24);
  const artifactsDir = path.join(dir, key);
  writeFileSync(artifactsDir, "fixture to force mkdir failure");
  const result = await supervise({ task: "t", guard: createGuard({ root: dir }), gate: gateC(dir),
    ...brainC({ patches: [fix] }), artifactsDir, opts: C });
  const attempt = result.reproduceAttempts[0];
  assert.equal(result.status, "PASS", "artifact diagnostic must not affect acceptance");
  assert.equal(attempt.sourceArtifact, null);
  assert.ok(/sk-\[REDACTED\]/.test(attempt.sourceArtifactError), "filesystem error must be redacted");
  assert.ok(!JSON.stringify(result).includes(key), "synthetic artifact secret leaked");
  assert.equal(readFileSync(artifactsDir, "utf8"), "fixture to force mkdir failure");
});

test("contract: cleanup exceptions keep the candidate for retry and use baseline final rollback", async () => {
  const dir = repoC();
  const guard = createGuard({ root: dir });
  const key = "sk-" + "c".repeat(24);
  const restore = guard.restore;
  let restores = 0;
  guard.restore = (snapshot) => {
    if (++restores === 1) throw new Error(`fixture cleanup failed for API_KEY=${key}`);
    return restore(snapshot);
  };
  const feedbackSeen = [];
  const result = await supervise({ task: "t", guard, gate: gateC(dir, ""), opts: C,
    ...brainC({ reproducer: async ({ feedback }) => {
      feedbackSeen.push(feedback);
      assert.equal(existsSync(path.join(dir, REPRO)), feedbackSeen.length === 2);
      return { file: REPRO, content: "// fixture\n" };
    } }),
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(/^CANNOT_REPRODUCE/.test(result.reason), "expected baseline stop reason");
  assert.equal(result.reproduceAttempts.length, 2);
  assert.ok(result.reproduceAttempts[0].cleanupError === "fixture cleanup failed for API_KEY=[REDACTED]", "cleanup error must be redacted");
  assert.ok(feedbackSeen[1] === result.reproduceAttempts[0].cleanupError, "retry must receive redacted cleanup error");
  assert.ok(!JSON.stringify({ result, feedbackSeen }).includes(key), "synthetic cleanup secret leaked");
  assert.equal(restores, 2);
  assert.ok(!existsSync(path.join(dir, REPRO)));
});

test("contract: a gate exception leaves the candidate until baseline final rollback", async () => {
  const dir = repoC();
  const artifactsDir = path.join(dir, "run-artifacts");
  const guard = createGuard({ root: dir });
  const nextFile = REPRO.replace("udon", "retry");
  const source = "// ตัวอย่าง\n";
  let gateCalls = 0;
  const gate = () => {
    if (++gateCalls === 1) return gateC(dir)();
    assert.ok(existsSync(path.join(dir, REPRO)));
    if (gateCalls === 2) throw new Error("fixture gate exception");
    assert.ok(existsSync(path.join(dir, nextFile)));
    return gateC(dir, "")();
  };
  const feedbackSeen = [];
  const r = await supervise({ task: "t", guard, gate, artifactsDir, opts: C,
    ...brainC({ reproducer: async ({ feedback }) => {
      feedbackSeen.push(feedback);
      const isRetry = feedbackSeen.length === 2;
      assert.equal(existsSync(path.join(dir, REPRO)), isRetry);
      return { file: isRetry ? nextFile : REPRO, content: source };
    } }),
  });
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.iterationCount, 0);
  assert.equal(r.reproduceAttempts.length, 2);
  const [first, second] = r.reproduceAttempts;
  assert.equal(first.outcome, "ERROR");
  assert.equal(first.gate, null);
  assert.equal(first.rejectionReason, "fixture gate exception");
  assert.equal(feedbackSeen[1], "fixture gate exception");
  assert.equal(first.sourceBytes, Buffer.byteLength(source, "utf8"));
  assert.equal(readFileSync(path.join(artifactsDir, first.sourceArtifact), "utf8"), source);
  assert.equal(second.outcome, "REJECTED");
  assert.ok(!existsSync(path.join(dir, REPRO)));
  assert.ok(!existsSync(path.join(dir, nextFile)));
  assert.ok(!guard.touched.has(nextFile));
  assert.deepEqual(r.filesChanged, []);
});

test("contract: guard-rejected API key and artifact-filtered bearer token are not persisted", async () => {
  const dir = repoC();
  const guard = createGuard({ root: dir });
  const artifactsDir = path.join(dir, "run-artifacts");
  const key = "sk-" + "d".repeat(24);
  const token = "fixture-bearer-a7ca";
  const candidates = [`// API_KEY=${key}\n`, `// Authorization: Bearer ${token}\n`];
  let attempts = 0;
  const result = await supervise({ task: "t", guard, gate: gateC(dir, ""), artifactsDir, opts: C,
    ...brainC({ reproducer: async () => {
      assert.ok(!existsSync(path.join(dir, REPRO)));
      assert.ok(!existsSync(artifactsDir));
      return { file: REPRO, content: candidates[attempts++] };
    } }),
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(attempts, 2);
  assert.equal(result.reproduceAttempts[0].outcome, "ERROR");
  assert.ok(/secret-looking content/.test(result.reproduceAttempts[0].rejectionReason), "guard must reject secret-looking content");
  assert.equal(result.reproduceAttempts[1].outcome, "ERROR");
  for (const attempt of result.reproduceAttempts) {
    assert.equal(attempt.sourceArtifact, null);
    assert.equal(attempt.sourceSha256, null);
    assert.equal(attempt.sourceBytes, 0);
  }
  for (const secret of [key, token]) assert.ok(!JSON.stringify(result).includes(secret), "synthetic source secret leaked");
  assert.ok(!existsSync(artifactsDir));
  assert.ok(!existsSync(path.join(dir, REPRO)));
});

for (const [boundary, suffix] of [["end of input", ""], ["a period", "."], ["a colon", ":"], ["exclamation", "!"], ["question", "?"], ["angle", ">"], ["backtick", String.fromCharCode(96)], ["bracket", "]"]]) {
  test(`contract: Basic credentials are redacted before ${boundary} in reproduction outputs and candidate artifacts`, async () => {
    const dir = repoC();
    const guard = createGuard({ root: dir });
    const credential = Buffer.from("fixture-basic-user:fixture-password").toString("base64");
    const header = `Authorization: bAsIc ${credential}${suffix}`;
    const value = `Basic ${credential}${suffix}`;
    const artifactsDir = path.join(dir, `Basic ${credential}`);
    writeFileSync(artifactsDir, "fixture to force mkdir failure");
    const logs = [];
    const feedbackSeen = [];
    const ordinaryGate = gateC(dir, "");
    let checks = 0;
    const restore = guard.restore;
    let restores = 0;
    guard.restore = (snapshot) => {
      if (++restores === 1) throw new Error(header);
      return restore(snapshot);
    };
    const result = await supervise({ task: "t", guard, artifactsDir, opts: C,
      log: (message) => logs.push(message),
      gate: () => {
        const g = ordinaryGate();
        if (++checks === 1) return g;
        return { ...g, checks: g.checks.map((check) => ({ ...check, summary: header, failures: [value] })) };
      },
      ...brainC({ reproducer: async ({ feedback }) => {
        feedbackSeen.push(feedback);
        if (feedbackSeen.length === 1) return { file: REPRO, content: "// safe fixture\n" };
        return { file: REPRO.replace("udon", "basic"), content: `// {"Authorization":"${value}"}\n` };
      } }),
    });
    const [first, second] = result.reproduceAttempts;
    const report = formatReport(result);
    assert.ok(!JSON.stringify({ result, report, logs, feedbackSeen }).includes(credential), "Basic credential leaked from reproduction");
    assert.ok(first.sourceArtifactError?.includes("Basic [REDACTED]"), "artifact error must redact Basic");
    assert.ok(first.cleanupError === `Authorization: bAsIc [REDACTED]${suffix}`, "cleanup error must redact Basic");
    assert.ok(first.rejectionReason === first.cleanupError, "rejection must redact Basic");
    assert.ok(feedbackSeen[1] === first.cleanupError, "retry must receive redacted Basic feedback");
    assert.ok(logs.some((message) => message.includes("bAsIc [REDACTED]")), "reproduction log must redact Basic");
    assert.ok(first.gate.checks.every((check) => check.summary === first.cleanupError &&
      check.failures[0] === `Basic [REDACTED]${suffix}`), "gate diagnostics must redact both Basic forms");
    assert.equal(second.sourceArtifact, null);
    assert.equal(second.sourceSha256, null);
    assert.equal(second.sourceBytes, 0);
    assert.ok(!existsSync(path.join(dir, REPRO)));
    assert.ok(!existsSync(path.join(dir, REPRO.replace("udon", "basic"))));
    assert.equal(readFileSync(artifactsDir, "utf8"), "fixture to force mkdir failure");

    let failure;
    try {
      assert.ok(!value.includes(credential), "synthetic credential must not appear in output");
    } catch (error) { failure = error; }
    assert.ok(failure?.code === "ERR_ASSERTION", "forced failure must be an assertion error");
    assert.ok(![`${failure}`, failure.stack, JSON.stringify(failure)].some((text) => text.includes(credential)),
      "boolean assertion must keep the credential out of failure output");
  });
}

test("contract: reproducer cannot create a production source file", async () => {
  const dir = repoC(); const guard = createGuard({ root: dir });
  const productionRepro = "src/lib/ai/understanding/repro-production.ts";
  let attempts = 0;
  const badReproducer = async () => {
    attempts++;
    return { file: productionRepro, content: "export const injected = true;\n" };
  };
  const r = await supervise({
    task: "t",
    guard,
    gate: gateC(dir),
    ...brainC({ patches: [fix], reproducer: badReproducer }),
    opts: C,
  });
  assert.equal(r.status, "BLOCKED");
  assert.match(r.reason, /CANNOT_REPRODUCE/);
  assert.equal(attempts, 2);
  assert.equal(r.reproduceAttempts.length, 2);
  assert.equal(r.reproduceAttempts[0].outcome, "ERROR");
  assert.match(r.reproduceAttempts[0].rejectionReason, /REPRO_FILE_RULE/);
  assert.ok(!existsSync(path.join(dir, productionRepro)));
});
test("contract: a repro test that does not fail -> CANNOT_REPRODUCE and the file is removed", async () => {
  const dir = repoC({ [PROV]: "export const v = 2;\n" }); const guard = createGuard({ root: dir });
  const r = await supervise({ task: "t", guard, gate: gateC(dir), ...brainC({ patches: [fix] }), opts: C });
  assert.equal(r.status, "BLOCKED"); assert.match(r.reason, /CANNOT_REPRODUCE/); assert.ok(!existsSync(path.join(dir, REPRO)));
});

test("contract: patch outside the planned layer is rejected (layer rule)", async () => {
  const dir = repoC(); const guard = createGuard({ root: dir });
  const wrongLayer = { edits: [{ file: GATE, old: "g = 1", new: "g = 2" }] };
  const r = await supervise({ task: "t", guard, gate: gateC(dir), ...brainC({ patches: [wrongLayer] }), opts: C });
  assert.equal(r.status, "BLOCKED"); assert.match(r.reason, /LAYER_RULE/); assert.equal(read(dir, GATE), "export const g = 1;\n");
});

test("contract: core-legacy requires evidence in core.ts", async () => {
  const dir = repoC(); const guard = createGuard({ root: dir });
  const r = await supervise({ task: "t", guard, gate: gateC(dir),
    ...brainC({
      planObj: plan({
        layers: ["core-legacy"],
        evidence: [{ file: PROV, symbol: "v = 1" }],
      }),
      patches: [fix],
    }),
    opts: C,
  });
  assert.equal(r.status, "BLOCKED");
  assert.match(r.reason, /LAYER_RULE/);
  assert.equal(read(dir, PROV), "export const v = 1;\n");
});

test("contract: several layers need a reason", async () => {
  const dir = repoC(); const guard = createGuard({ root: dir });
  const r = await supervise({ task: "t", guard, gate: gateC(dir), ...brainC({ planObj: plan({ layers: ["understanding", "gate"] }), patches: [fix] }), opts: C });
  assert.match(r.reason, /multiLayerReason/);
  const ok = await supervise({ task: "t", guard: createGuard({ root: repoC() }), gate: gateC(dir), ...brainC({ planObj: plan({ layers: ["understanding", "gate"], multiLayerReason: "gate also needs the new intent" }), patches: [fix] }), opts: { ...C, reproduce: false, allowGreenBaseline: true } });
  assert.ok(ok.status !== undefined);
});

test("contract: hard-coding a test sentence into production code is rejected", async () => {
  const dir = repoC({ [USERTEST]: "it('x', () => { expect(f('สนใจโปรแกรมอุดร')).toBe(1); });\n" }); const guard = createGuard({ root: dir });
  const cheat = { edits: [{ file: PROV, old: "v = 1", new: "v = 2; if (msg === 'สนใจโปรแกรมอุดร') return 1" }] };
  const r = await supervise({ task: "t", guard, gate: gateC(dir, USERTEST), ...brainC({ patches: [cheat] }), opts: { ...C, failureLimit: 1 } });
  assert.equal(r.status, "BLOCKED"); assert.match(r.reason, /HARDCODE_GUARD/); assert.equal(read(dir, PROV), "export const v = 1;\n");
  const honest = { edits: [{ file: PROV, old: "v = 1", new: "v = 2 // normalise marker" }] };
  const ok = await supervise({ task: "t", guard: createGuard({ root: dir }), gate: gateC(dir, USERTEST), ...brainC({ patches: [honest] }), opts: C });
  assert.equal(ok.status, "PASS", ok.reason);
});

test("contract: root cause evidence must exist in the source, otherwise no patch is attempted", async () => {
  const dir = repoC(); const guard = createGuard({ root: dir }); let patched = 0;
  const bad = plan({ evidence: [{ file: PROV, symbol: "doesNotExistAnywhere" }] });
  const r = await supervise({ task: "t", guard, gate: gateC(dir), ...brainC({ planObj: bad, patches: [() => { patched++; return fix; }] }), opts: C });
  assert.equal(r.status, "BLOCKED"); assert.match(r.reason, /PLAN_REJECTED/); assert.equal(patched, 0);
});

test("contract: green tests are not enough - unrelated file changes or oversized patches fail the Definition of Done", async () => {
  const dir = repoC(); const guard = createGuard({ root: dir });
  const stray = () => { writeFileSync(path.join(dir, "stray-notes.txt"), "x"); return fix; };
  const r = await supervise({ task: "t", guard, gate: gateC(dir), ...brainC({ patches: [stray] }), opts: C });
  assert.equal(r.status, "BLOCKED"); assert.match(r.reason, /DOD_FAILED: unrelated/);
  const dir2 = repoC(); const big = { edits: [{ file: PROV, old: "v = 1", new: "v = 2\n" + Array.from({ length: 100 }, (_, i) => `export const k${i} = ${i};`).join("\n") }] };
  const r2 = await supervise({ task: "t", guard: createGuard({ root: dir2 }), gate: gateC(dir2), ...brainC({ patches: [big] }), opts: C });
  assert.equal(r2.status, "BLOCKED"); assert.match(r2.reason, /DOD_FAILED: minimal/);
});

test("approve: only commits exactly what was reported (hash-verified)", async () => {
  const { verifyReport } = await import("../wos-ai-agent-approve.mjs");
  const dir = repoC(); const content = read(dir, PROV);
  const { createHash } = await import("node:crypto");
  const rep = { status: "PASS", awaitingApproval: true, files: [{ path: PROV, sha256: createHash("sha256").update(content).digest("hex") }] };
  assert.deepEqual(verifyReport(rep, dir), []);
  writeFileSync(path.join(dir, PROV), content + "// edited after review\n");
  assert.match(verifyReport(rep, dir).join(), /changed since the agent reported/);
  assert.match(verifyReport({ ...rep, status: "BLOCKED" }, dir).join(), /not a PASS/);
  assert.match(verifyReport({ ...rep, files: [{ path: "../x.ts", sha256: "0" }] }, dir).join(), /escapes repository/);
});

test("gate: a dead dev server is an ENVIRONMENT problem, not 23 bugs", async () => {
  const { regressionEnvBroken } = await import("./gate.mjs");
  const down = ["T1a", "T1b", "T1c", "T1d"].map((t) => `[${t}_x] label ... FAIL - request failed: fetch failed`).join("\n");
  assert.match(regressionEnvBroken(down), /not reachable/);
  const mixed = "[T1a_x] l ... FAIL - HTTP 500, expected 200\n[T1b_x] l ... FAIL - response says not-found\n[T1c_x] l ... FAIL - wrong text\n[T1d_x] l ... PASS";
  assert.equal(regressionEnvBroken(mixed), "");
  assert.match(regressionEnvBroken("Test runner crashed: boom"), /crashed/);
});

test("supervisor: ENV_ERROR in the baseline stops before planning or patching", async () => {
  const dir = repoC(); const guard = createGuard({ root: dir }); let planned = 0;
  const g = () => ({ ok: false, score: 1, signature: "e", failures: ["regression::environment_unreachable"], diffCheckAllIds: new Set(), checks: [{ name: "regression", status: "ENV_ERROR", failures: ["regression::environment_unreachable"], summary: "23/23 regression cases failed with request/HTTP errors: not reachable" }] });
  const r = await supervise({ task: "t", guard, gate: g, ...brainC({ patches: [fix], planner: async () => { planned++; return plan(); } }), opts: C });
  assert.equal(r.status, "BLOCKED"); assert.match(r.reason, /ENVIRONMENT_UNHEALTHY/); assert.equal(planned, 0); assert.equal(r.iterationCount, 0);
});

test("llm: a plan that names 3+ layers is rejected as 'not a diagnosis'", async () => {
  const { makeLlm } = await import("./llm.mjs");
  const dir = repoC(); const guard = createGuard({ root: dir });
  const everything = { rootCause: "x".repeat(60), layers: ["understanding", "gate", "orchestrator", "state"], multiLayerReason: "y".repeat(30), evidence: [{ file: PROV, symbol: "v = 1" }] };
  const llm = makeLlm({ guard, contract: true, ask: async () => ({ text: JSON.stringify(everything), json: structuredClone(everything) }) });
  await assert.rejects(llm.planner({ task: "t", baseline: { failures: [] }, timeLeft: 60000 }), /not a diagnosis/);
});

// ======================================================================================================
// claude-exec adapter (Phase 1). No Claude model and no network: the "claude" in these tests is a tiny node
// script that reads stdin and prints a canned Claude-CLI-shaped JSON envelope.
// ======================================================================================================
import { askClaudeOnce, buildChildEnv, buildClaudeArgs, ClaudeExecError, compareSemver, discoverClaudeExecutable, makeClaudeAsk } from "./claude-exec.mjs";

const THAI = "สนใจตรวจสุขภาพ";
const LAO = "ກວດສຸຂະພາບ";
const THAI_ESC = "\u0e2a\u0e19\u0e43\u0e08\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e38\u0e02\u0e20\u0e32\u0e1e";
const LAO_ESC = "\u0e81\u0ea7\u0e94\u0eaa\u0eb8\u0e82\u0eb0\u0e9e\u0eb2\u0e9a";

const FAKE_CLAUDE = `
const mode = process.argv[2];
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = Buffer.concat(chunks).toString("utf8");
const BT = String.fromCharCode(96), NL = String.fromCharCode(10);
const envelope = (result) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result: typeof result === "string" ? result : JSON.stringify(result), total_cost_usd: 0.01, duration_ms: 5 });
const reply = (result) => process.stdout.write(envelope(result));
if (mode === "ok") reply({ ok: true, n: 1 });
else if (mode === "echo") reply({ echo: input, argv: process.argv.slice(3), leaked: Object.keys(process.env).filter((k) => /LITELLM|OPENAI|SUPABASE|TELEGRAM|^WOS_/i.test(k)), anthropic: Object.keys(process.env).filter((k) => /^ANTHROPIC_/i.test(k)) });
else if (mode === "fenced") reply(BT + BT + BT + "json" + NL + '{"a":1}' + NL + BT + BT + BT);
else if (mode === "bom") process.stdout.write(String.fromCharCode(0xfeff) + envelope({ ok: true }));
else if (mode === "badjson") process.stdout.write("this is not json");
else if (mode === "badresult") reply("definitely not json");
else if (mode === "array") reply("[1,2,3]");
else if (mode === "iserror") process.stdout.write(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, result: "stopped" }));
else if (mode === "empty") { /* no output at all */ }
else if (mode === "nonzero") { process.stderr.write("boom API_KEY=" + ("sk-" + "abcdefghijklmnopqrstuvwxyz0123456789") + " failed"); process.exit(3); }
else if (mode === "sleep") setTimeout(() => {}, 60000);
else if (mode === "fffd") reply({ text: "bad " + String.fromCharCode(0xfffd) });
else if (mode === "badutf8") process.stdout.write(Buffer.from([0x7b, 0xff, 0x7d]));
`;

function fakeClaude(mode) {
  const dir = mkdtempSync(path.join(tmpdir(), "claude-fake-"));
  const script = path.join(dir, "fake-claude.mjs");
  writeFileSync(script, FAKE_CLAUDE, "utf8");
  return { executable: process.execPath, prefixArgs: [script, mode] };
}
const MSG = (text = "hello") => [{ role: "system", content: "sys" }, { role: "user", content: text }];
const failsWith = (promise, code) => assert.rejects(promise, (e) => e instanceof ClaudeExecError && e.code === code, `expected ${code}`);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof ClaudeExecError && e.code === code, `expected ${code}`);

const APPDATA = "C:\\Users\\t\\AppData\\Roaming";
const BUNDLED_ROOT = path.win32.join(APPDATA, "Claude", "claude-code");
const bundledExe = (v) => path.win32.join(BUNDLED_ROOT, v, "claude.exe");
const fakeFs = (files = [], dirs = {}) => ({ existsSync: (p) => files.includes(p), readdirSync: (p) => { if (!(p in dirs)) throw new Error("ENOENT"); return dirs[p]; } });
const versionOk = (v = "2.1.170") => () => ({ status: 0, stdout: `${v} (Claude Code)\n`, stderr: "" });
const discoverWin = (o = {}) => discoverClaudeExecutable({ platform: "win32", env: { APPDATA, PATH: "", ...(o.env ?? {}) }, fsImpl: o.fsImpl ?? fakeFs(), spawnSyncImpl: o.spawnSyncImpl ?? versionOk() });

test("claude-exec: the test strings really are Thai and Lao (the test file itself is not corrupted)", () => {
  assert.equal(THAI, THAI_ESC);
  assert.equal(LAO, LAO_ESC);
  assert.ok(!THAI.includes("\uFFFD") && !LAO.includes("\uFFFD"));
});

test("claude-exec: WOS_CLAUDE_EXE override wins over PATH and bundled, and never falls back silently", () => {
  const env = { WOS_CLAUDE_EXE: "D:\\tools\\claude-custom.exe", PATH: "C:\\bin" };
  const fsImpl = fakeFs(["D:\\tools\\claude-custom.exe", "C:\\bin\\claude.exe", bundledExe("2.1.170")], { [BUNDLED_ROOT]: ["2.1.170"] });
  const hit = discoverWin({ env, fsImpl, spawnSyncImpl: versionOk("9.9.9") });
  assert.equal(hit.path, "D:\\tools\\claude-custom.exe"); assert.equal(hit.source, "env"); assert.equal(hit.version, "9.9.9");
  throwsCode(() => discoverWin({ env: { WOS_CLAUDE_EXE: "D:\\nope\\claude.exe", PATH: "C:\\bin" }, fsImpl: fakeFs(["C:\\bin\\claude.exe"]) }), "CLAUDE_NOT_FOUND");
});

test("claude-exec: PATH discovery finds claude.exe (and ignores .cmd shims that cannot be spawned without a shell)", () => {
  const env = { PATH: "C:\\Windows;C:\\tools\\bin" };
  const hit = discoverWin({ env, fsImpl: fakeFs(["C:\\tools\\bin\\claude.exe", bundledExe("2.1.170")], { [BUNDLED_ROOT]: ["2.1.170"] }) });
  assert.equal(hit.path, "C:\\tools\\bin\\claude.exe"); assert.equal(hit.source, "path");
  throwsCode(() => discoverWin({ env, fsImpl: fakeFs(["C:\\tools\\bin\\claude.cmd"]) }), "CLAUDE_NOT_FOUND");
});

test("claude-exec: bundled discovery picks the highest NUMERIC version (2.1.9 < 2.1.10), no hard-coded version", () => {
  assert.equal(compareSemver("2.1.9", "2.1.10"), -1); assert.equal(compareSemver("2.1.10", "2.1.9"), 1); assert.equal(compareSemver("2.1.10-beta.1", "2.1.10"), -1);
  assert.ok(["2.1.9", "2.1.10"].sort().at(-1) === "2.1.9", "a plain string sort would pick 2.1.9: that is the bug this test guards");
  const names = ["2.1.9", "2.1.10", "2.0.99", "notes", "2.1.10-beta.1", "2.1.100x"];
  const fsImpl = fakeFs(["2.1.9", "2.1.10", "2.0.99", "2.1.10-beta.1"].map(bundledExe), { [BUNDLED_ROOT]: names });
  const seen = [];
  const hit = discoverWin({ fsImpl, spawnSyncImpl: (exe) => { seen.push(exe); return { status: 0, stdout: "2.1.10 (Claude Code)", stderr: "" }; } });
  assert.equal(hit.path, bundledExe("2.1.10")); assert.equal(hit.source, "bundled"); assert.deepEqual(seen, [bundledExe("2.1.10")]);
  const hit2 = discoverWin({ fsImpl, spawnSyncImpl: (exe) => (exe.includes("2.1.10") ? { status: 1, stdout: "", stderr: "broken" } : { status: 0, stdout: "2.1.9 (Claude Code)", stderr: "" }) });
  assert.equal(hit2.path, bundledExe("2.1.9"), "a broken newest bundle falls back to the next one");
});

test("claude-exec: missing executable is reported as CLAUDE_NOT_FOUND", () => {
  throwsCode(() => discoverWin(), "CLAUDE_NOT_FOUND");
  throwsCode(() => discoverClaudeExecutable({ platform: "win32", env: { PATH: "" }, fsImpl: fakeFs(), spawnSyncImpl: versionOk() }), "CLAUDE_NOT_FOUND");
});

test("claude-exec: --version validation failures (exit code, no version, timeout) are CLAUDE_VERSION_INVALID", () => {
  const fsImpl = fakeFs(["C:\\bin\\claude.exe"]); const env = { PATH: "C:\\bin" };
  throwsCode(() => discoverWin({ env, fsImpl, spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "nope" }) }), "CLAUDE_VERSION_INVALID");
  throwsCode(() => discoverWin({ env, fsImpl, spawnSyncImpl: () => ({ status: 0, stdout: "hello world", stderr: "" }) }), "CLAUDE_VERSION_INVALID");
  throwsCode(() => discoverWin({ env, fsImpl, spawnSyncImpl: () => ({ error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }) }) }), "CLAUDE_VERSION_INVALID");
  throwsCode(() => discoverWin({ env: { WOS_CLAUDE_EXE: "C:\\bin\\claude.exe", PATH: "" }, fsImpl, spawnSyncImpl: () => ({ status: 2, stdout: "", stderr: "" }) }), "CLAUDE_VERSION_INVALID");
});

test("claude-exec: a valid reply becomes { text, json } (also fenced JSON and a BOM before the output)", async () => {
  const r = await askClaudeOnce(MSG(), 30_000, "sonnet", fakeClaude("ok"));
  assert.deepEqual(r.json, { ok: true, n: 1 }); assert.equal(r.text, '{"ok":true,"n":1}'); assert.equal(r.meta.costUsd, 0.01);
  assert.deepEqual((await askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("fenced"))).json, { a: 1 });
  assert.deepEqual((await askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("bom"))).json, { ok: true });
});

test("claude-exec: it satisfies the makeLlm contract (askValidated accepts it as `ask`)", async () => {
  const { askValidated } = await import("./llm.mjs");
  let discovered = 0;
  const ask = makeClaudeAsk({ ...fakeClaude("ok"), executable: undefined, discover: () => { discovered++; return { path: process.execPath }; } });
  const j1 = await askValidated({ system: "s", user: "u", timeLeft: 30_000, ask, validate: (x) => (x.ok === true ? "" : "bad") });
  await askValidated({ system: "s", user: "u", timeLeft: 30_000, ask, validate: () => "" });
  assert.deepEqual(j1, { ok: true, n: 1 }); assert.equal(discovered, 1, "discovery happens once, lazily");
});

test("claude-exec: malformed output is rejected (not JSON, result not JSON, not an object, CLI error, empty)", async () => {
  await failsWith(askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("badjson")), "CLAUDE_BAD_JSON");
  await failsWith(askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("badresult")), "CLAUDE_BAD_JSON");
  await failsWith(askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("array")), "CLAUDE_BAD_SCHEMA");
  await failsWith(askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("iserror")), "CLAUDE_ERROR_RESULT");
  await failsWith(askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("empty")), "CLAUDE_EMPTY");
});

test("claude-exec: non-zero exit is an error and stderr secrets are scrubbed before they reach the message", async () => {
  await assert.rejects(askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("nonzero")), (e) => {
    assert.ok(e instanceof ClaudeExecError && e.code === "CLAUDE_EXIT");
    assert.match(e.message, /exited with 3/); assert.match(e.message, /REDACTED/);
    assert.ok(!e.message.includes("sk-abcdefghij") && !e.message.includes("0123456789"), e.message);
    return true;
  });
});

test("claude-exec: timeout kills the process and is capped by timeLeft; no time left never spawns", async () => {
  const t0 = Date.now();
  await failsWith(askClaudeOnce(MSG(), 1500, undefined, fakeClaude("sleep")), "CLAUDE_TIMEOUT");
  assert.ok(Date.now() - t0 < 20_000, "the 60s sleeper must have been killed");
  let spawned = 0;
  await failsWith(askClaudeOnce(MSG(), 500, undefined, { ...fakeClaude("ok"), spawnImpl: () => { spawned++; throw new Error("must not spawn"); } }), "CLAUDE_TIMEOUT");
  assert.equal(spawned, 0);
});

test("claude-exec: Thai and Lao survive stdin -> process -> stdout byte for byte; a leading BOM is stripped", async () => {
  const prompt = `\uFEFF${THAI} / ${LAO}`;
  const r = await askClaudeOnce([{ role: "system", content: prompt }, { role: "user", content: `${LAO} ${THAI}` }], 30_000, undefined, fakeClaude("echo"));
  assert.ok(r.json.echo.includes(THAI) && r.json.echo.includes(LAO), "Thai and Lao reached the child intact");
  assert.ok(r.json.echo.includes(`${LAO} ${THAI}`)); assert.ok(!r.json.echo.includes("\uFEFF")); assert.ok(!r.json.echo.includes("\uFFFD"));
  assert.ok(!r.json.argv.join(" ").includes(THAI), "the prompt travels over stdin, never on the command line");
});

test("claude-exec: U+FFFD / lone surrogates in the input are refused before spawning; bad bytes or U+FFFD in the output are rejected", async () => {
  let spawned = 0; const spy = { ...fakeClaude("ok"), spawnImpl: () => { spawned++; throw new Error("must not spawn"); } };
  await failsWith(askClaudeOnce(MSG(`corrupted ${"\uFFFD"}${"\uFFFD"} text`), 30_000, undefined, spy), "CLAUDE_ENCODING");
  await failsWith(askClaudeOnce(MSG("lone \ud800 surrogate"), 30_000, undefined, spy), "CLAUDE_ENCODING");
  assert.equal(spawned, 0);
  await failsWith(askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("fffd")), "CLAUDE_ENCODING");
  await failsWith(askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("badutf8")), "CLAUDE_ENCODING");
});

test("claude-exec: no permission bypass, tools disabled, prompt not on the command line (checked on the real child argv)", async () => {
  const r = await askClaudeOnce(MSG("hello"), 30_000, "sonnet", { ...fakeClaude("echo"), maxBudgetUsd: 0.5 });
  const argv = r.json.argv;
  assert.ok(!argv.some((a) => /dangerously|bypass/i.test(a)), argv.join(" ")); assert.ok(!argv.includes("--permission-mode"));
  const i = argv.indexOf("--tools"); assert.ok(i >= 0 && argv[i + 1] === "", "--tools is followed by an empty string = all tools disabled");
  for (const [flag, value] of [["--input-format", "text"], ["--output-format", "json"]]) assert.equal(argv[argv.indexOf(flag) + 1], value);
  for (const flag of ["--print", "--safe-mode", "--no-session-persistence"]) assert.ok(argv.includes(flag), flag);
  assert.equal(argv[argv.indexOf("--model") + 1], "sonnet"); assert.equal(argv[argv.indexOf("--max-budget-usd") + 1], "0.5");
  assert.ok(!argv.includes("hello") && !argv.join(" ").includes("hello"), "prompt text is not an argument");
  const direct = buildClaudeArgs();
  assert.ok(!direct.some((a) => /dangerously|bypass/i.test(a)) && direct[direct.indexOf("--tools") + 1] === "");
  throwsCode(() => buildClaudeArgs({ model: "--dangerously-skip-permissions" }), "CLAUDE_BAD_ARGS");
  throwsCode(() => buildClaudeArgs({ model: "bypassPermissions" }), "CLAUDE_BAD_ARGS");
  throwsCode(() => buildClaudeArgs({ maxBudgetUsd: -1 }), "CLAUDE_BAD_ARGS");
});

test("claude-exec: the child never receives the WOS app secrets (env allowlist), only PATH/profile/Claude auth variables", async () => {
  const keep = {}; const set = { LITELLM_API_KEY: "x-not-real", OPENAI_API_KEY: "x-not-real", TELEGRAM_BOT_TOKEN: "x-not-real", WOS_AI_AGENT_MODEL: "x", ANTHROPIC_TEST_FORWARD: "1" };
  for (const k of Object.keys(set)) { keep[k] = process.env[k]; process.env[k] = set[k]; }
  try {
    const r = await askClaudeOnce(MSG(), 30_000, undefined, fakeClaude("echo"));
    assert.deepEqual(r.json.leaked, []); assert.deepEqual(r.json.anthropic, ["ANTHROPIC_TEST_FORWARD"]);
    const env = buildChildEnv({ PATH: "p", LITELLM_API_KEY: "k", SUPABASE_SERVICE_ROLE_KEY: "k", CLAUDE_CODE_X: "1" });
    assert.deepEqual(Object.keys(env).sort(), ["CLAUDE_CODE_X", "NO_COLOR", "PATH"]);
  } finally { for (const k of Object.keys(set)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
});


// ======================================================================================================
// claude-exec: Windows npm shim. claude.cmd is parsed as DATA only; the native claude.exe is spawned directly
// (no shell, argv array). Fixtures are fake file systems with explicit win32 paths, so results do not depend on the host.
// ======================================================================================================
import { resolveNpmShim, listClaudeOnPath, validateClaudeExecutable, CLAUDE_VERSION_RE } from "./claude-exec.mjs";
import { EventEmitter as ShimEmitter } from "node:events";
import { mkdirSync as shimMkdirSync, symlinkSync as shimSymlinkSync, rmSync as shimRmSync } from "node:fs";

const SHIM_LAUNCH_LINE = '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*';
const SHIM_LINES = ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", SHIM_LAUNCH_LINE];
const shimText = (lines = SHIM_LINES, eol = "\r\n") => lines.join(eol) + eol;
const NPM_DIR = "C:\\Users\\John Doe\\AppData\\Roaming\\npm";
const NPM_CMD = `${NPM_DIR}\\claude.cmd`;
const PKG_DIR = `${NPM_DIR}\\node_modules\\@anthropic-ai\\claude-code`;
const NPM_EXE = `${PKG_DIR}\\bin\\claude.exe`;

function shimFs({ cmds = { [NPM_CMD]: shimText() }, files = [NPM_EXE], real = {} } = {}) {
  const byLower = new Map(Object.entries(cmds).map(([k, v]) => [k.toLowerCase(), v]));
  const have = new Set([...byLower.keys(), ...files.map((f) => f.toLowerCase())]);
  const text = (p) => { const t = byLower.get(String(p).toLowerCase()); if (t === undefined) throw new Error("ENOENT"); return t; };
  return {
    existsSync: (p) => have.has(String(p).toLowerCase()),
    readFileSync: (p) => text(p),
    statSync: (p) => ({ size: Buffer.byteLength(text(p), "utf8") }),
    realpathSync: (p) => real[p] ?? String(p),
    readdirSync: () => { throw new Error("ENOENT"); },
  };
}

function spyClaudeSpawn(calls, reply = { ok: true }) {
  return (command, args, options) => {
    const rec = { command, args, options, stdin: "" }; calls.push(rec);
    const child = new ShimEmitter(); child.stdout = new ShimEmitter(); child.stderr = new ShimEmitter(); child.kill = () => {};
    child.stdin = {
      on() {},
      end(buf) {
        rec.stdin = Buffer.from(buf).toString("utf8");
        setImmediate(() => {
          child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(reply) })));
          child.emit("close", 0, null);
        });
      },
    };
    return child;
  };
}

test("claude-exec: a valid official npm shim resolves to the native claude.exe (paths with spaces, CRLF/LF/BOM/blank lines)", () => {
  for (const text of [shimText(), shimText(SHIM_LINES, "\n"), "\uFEFF" + shimText(), shimText(SHIM_LINES.map((l) => `  ${l}  `)), `\r\n${shimText()}\r\n\r\n`]) {
    const d = resolveNpmShim(NPM_CMD, { fsImpl: shimFs({ cmds: { [NPM_CMD]: text } }) });
    assert.ok(d, "official shim must resolve");
    assert.equal(d.command, NPM_EXE); assert.equal(d.path, NPM_EXE); assert.deepEqual(d.prefixArgs, []); assert.equal(d.via, "npm-shim"); assert.equal(d.shim, NPM_CMD);
    assert.ok(!/\.cmd$/i.test(d.command), "the resolved command is native, never the .cmd");
  }
});

test("claude-exec: malformed or hostile shims are rejected (chaining, traversal, other targets, %COMSPEC%, extra commands, missing %*, empty, NUL, oversize)", () => {
  const L = SHIM_LAUNCH_LINE, head = SHIM_LINES.slice(0, -1);
  const variants = {
    amp: [...head, `${L} & calc`], andand: [...head, `${L} && calc`], oror: [...head, `${L} || calc`], pipe: [...head, `${L} | more`], redirect: [...head, `${L} > out.txt`],
    traversal: [...head, '"%dp0%\\..\\..\\evil.exe"   %*'],
    traversal2: [...head, '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\..\\..\\..\\..\\evil.exe"   %*'],
    arbitrary: [...head, '"C:\\Windows\\System32\\calc.exe"   %*'], otherPkg: [...head, '"%dp0%\\node_modules\\other\\bin\\tool.exe"   %*'],
    comspec: [...head, "%COMSPEC% /c calc"], comspecLaunch: [...head, '"%COMSPEC%"   %*'], envExpansion: [...head, '"%dp0%\\node_modules\\@anthropic-ai\\%PKG%\\bin\\claude.exe"   %*'],
    otherCall: [...head, "CALL C:\\evil.bat", L], extraCommandBefore: [...head, "calc.exe", L], extraCommandAfter: [...SHIM_LINES, "ECHO done"],
    extraLaunch: [...SHIM_LINES, L], noForward: [...head, '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"'],
    wrongForward: [...head, '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %1'], echoChain: ["@ECHO off & calc", ...SHIM_LINES.slice(1)],
    noDp0: SHIM_LINES.filter((l) => !/^SET dp0/.test(l)), noLaunch: head, empty: [""], oversize: [...SHIM_LINES, "x".repeat(5000)],
  };
  for (const [name, lines] of Object.entries(variants)) assert.equal(resolveNpmShim(NPM_CMD, { fsImpl: shimFs({ cmds: { [NPM_CMD]: shimText(lines) } }) }), null, `variant ${name} must be rejected`);
  assert.equal(resolveNpmShim(NPM_CMD, { fsImpl: shimFs({ cmds: { [NPM_CMD]: shimText() + "\0" } }) }), null, "NUL byte");
  assert.equal(resolveNpmShim(NPM_CMD, { fsImpl: shimFs({ cmds: { [NPM_CMD]: "" } }) }), null, "empty file");
  for (const p of ["claude.cmd", `${NPM_DIR}\\claude.ps1`, `${NPM_DIR}\\claude.bat`, `${NPM_DIR}\\claude`, "\\\\server\\share\\claude.cmd", undefined, 42]) assert.equal(resolveNpmShim(p, { fsImpl: shimFs() }), null, String(p));
});

test("claude-exec: missing target and realpath escapes are rejected (junction out of the package, out of node_modules, lookalike folder, wrong basename)", () => {
  assert.equal(resolveNpmShim(NPM_CMD, { fsImpl: shimFs({ files: [] }) }), null, "missing target");
  const escapes = {
    exeOutside: { [NPM_EXE]: "D:\\evil\\claude.exe" },
    pkgJunction: { [PKG_DIR]: "D:\\evil\\pkg", [NPM_EXE]: "D:\\evil\\pkg\\bin\\claude.exe" },
    dirElsewhere: { [NPM_DIR]: "E:\\other" },
    lookalike: { [NPM_EXE]: `${NPM_DIR}\\node_modules\\@anthropic-ai\\claude-code-evil\\bin\\claude.exe` },
    wrongName: { [NPM_EXE]: `${PKG_DIR}\\bin\\evil.exe` },
    pkgOutsideNodeModules: { [PKG_DIR]: `${NPM_DIR}\\somewhere\\claude-code`, [NPM_EXE]: `${NPM_DIR}\\somewhere\\claude-code\\bin\\claude.exe` },
  };
  for (const [name, real] of Object.entries(escapes)) assert.equal(resolveNpmShim(NPM_CMD, { fsImpl: shimFs({ real }) }), null, `escape ${name}`);
  const caseOnly = resolveNpmShim(NPM_CMD, { fsImpl: shimFs({ real: { [NPM_EXE]: NPM_EXE.toUpperCase() } }) });
  assert.ok(caseOnly && caseOnly.command === NPM_EXE.toUpperCase(), "Windows paths are case-insensitive: a case-only difference is still inside the package");
});

test("claude-exec: PATH discovery with claude.cmd (npm shim), claude.exe priority, and malformed shim skipped for the next candidate", () => {
  const env = { PATH: NPM_DIR };
  const hit = discoverWin({ env, fsImpl: shimFs(), spawnSyncImpl: versionOk("2.1.302") });
  assert.equal(hit.via, "npm-shim"); assert.equal(hit.source, "path"); assert.equal(hit.command, NPM_EXE); assert.equal(hit.path, NPM_EXE); assert.deepEqual(hit.prefixArgs, []); assert.equal(hit.version, "2.1.302");
  const both = shimFs({ files: [NPM_EXE, `${NPM_DIR}\\claude.exe`] });
  const pick = discoverWin({ env, fsImpl: both, spawnSyncImpl: versionOk("2.1.302") });
  assert.equal(pick.command, `${NPM_DIR}\\claude.exe`); assert.equal(pick.via, "exe");
  assert.deepEqual(listClaudeOnPath({ env, platform: "win32", fsImpl: both }).map((d) => d.via), ["exe"]);
  const bad = "C:\\bad dir", good = "C:\\good dir";
  const mixed = shimFs({ cmds: { [`${bad}\\claude.cmd`]: shimText([...SHIM_LINES, "calc"]), [NPM_CMD]: shimText() }, files: [NPM_EXE, `${good}\\claude.exe`] });
  const next = discoverWin({ env: { PATH: `${bad};${good};${NPM_DIR}` }, fsImpl: mixed, spawnSyncImpl: versionOk() });
  assert.equal(next.command, `${good}\\claude.exe`, "the malformed shim is skipped and the next candidate wins");
  const onlyBad = shimFs({ cmds: { [`${bad}\\claude.cmd`]: shimText([...SHIM_LINES, "calc"]) }, files: [] });
  throwsCode(() => discoverWin({ env: { PATH: bad }, fsImpl: onlyBad }), "CLAUDE_NOT_FOUND");
  const seen = [];
  discoverWin({ env, fsImpl: shimFs(), spawnSyncImpl: (cmd, args, opts) => { seen.push({ cmd, args, opts }); return { status: 0, stdout: "2.1.302 (Claude Code)\r\n", stderr: "" }; } });
  assert.equal(seen.length, 1); assert.equal(seen[0].cmd, NPM_EXE); assert.deepEqual(seen[0].args, ["--version"]); assert.ok(seen[0].opts.shell !== true);
});

test("claude-exec: WOS_CLAUDE_EXE=.cmd resolves an official shim; a malformed .cmd, .ps1 or .bat override fails closed without falling back", () => {
  const exeOnPath = `C:\\bin\\claude.exe`;
  const hit = discoverWin({ env: { WOS_CLAUDE_EXE: NPM_CMD, PATH: "" }, fsImpl: shimFs(), spawnSyncImpl: versionOk("2.1.302") });
  assert.equal(hit.source, "env"); assert.equal(hit.via, "npm-shim"); assert.equal(hit.command, NPM_EXE);
  const hit2 = discoverWin({ env: { WOS_CLAUDE_EXE: `"${NPM_CMD}"`, PATH: "" }, fsImpl: shimFs(), spawnSyncImpl: versionOk("2.1.302") });
  assert.equal(hit2.command, NPM_EXE, "surrounding quotes are tolerated");
  const evil = shimFs({ cmds: { [NPM_CMD]: shimText([...SHIM_LINES.slice(0, -1), `${SHIM_LAUNCH_LINE} & calc`]) }, files: [NPM_EXE, exeOnPath] });
  throwsCode(() => discoverWin({ env: { WOS_CLAUDE_EXE: NPM_CMD, PATH: "C:\\bin" }, fsImpl: evil }), "CLAUDE_UNSUPPORTED_SHIM");
  for (const ext of ["ps1", "bat", "js"]) {
    const f = `${NPM_DIR}\\claude.${ext}`;
    throwsCode(() => discoverWin({ env: { WOS_CLAUDE_EXE: f, PATH: "C:\\bin" }, fsImpl: shimFs({ files: [NPM_EXE, f, exeOnPath] }) }), "CLAUDE_UNSUPPORTED_SHIM");
  }
  throwsCode(() => discoverWin({ env: { WOS_CLAUDE_EXE: `${NPM_DIR}\\missing.cmd`, PATH: "" }, fsImpl: shimFs() }), "CLAUDE_NOT_FOUND");
});

test("claude-exec: strict Claude Code identity: '2.1.302 (Claude Code)' passes; bare versions and other products fail", () => {
  const run = (stdout) => validateClaudeExecutable({ command: NPM_EXE, prefixArgs: [] }, { spawnSyncImpl: () => ({ status: 0, stdout, stderr: "" }) });
  assert.equal(run("2.1.302 (Claude Code)").version, "2.1.302"); assert.equal(run("2.1.302 (Claude Code)\r\n").version, "2.1.302");
  assert.equal(run("\uFEFF2.1.302-beta.1 (Claude Code)").version, "2.1.302-beta.1"); assert.equal(run("2.1.302 (Claude Code)\nextra line").version, "2.1.302");
  for (const bad of ["2.1.302", "1.0.0 (Something Else)", "hello 2.1.302 (Claude Code)", "(Claude Code)", "Claude Code 2.1.302", "", "2.1 (Claude Code)"]) throwsCode(() => run(bad), "CLAUDE_VERSION_INVALID");
  assert.ok(CLAUDE_VERSION_RE.test("2.1.302 (Claude Code)") && !CLAUDE_VERSION_RE.test("2.1.302"));
  const calls = [];
  validateClaudeExecutable({ command: "x.exe", prefixArgs: ["a.js"] }, { spawnSyncImpl: (c, a, o) => { calls.push({ c, a, o }); return { status: 0, stdout: "1.0.0 (Claude Code)", stderr: "" }; } });
  assert.deepEqual(calls[0].a, ["a.js", "--version"]); assert.equal(calls[0].o.shell, false);
});

test("sanitizer: inspection and serialization fail closed", () => {
  const credential = Buffer.from("fixture:synthetic").toString("base64");
  const unsafe = { get value() { throw new Error(credential); } };
  assert.ok(!inspectText(unsafe).safe && inspectText(unsafe).text === WITHHELD);
  assert.ok(safeJson(unsafe) === JSON.stringify({ error: WITHHELD }));
  const benign = "ordinary prose about basic concepts";
  assert.deepEqual(inspectText(benign), { text: benign, safe: true });
  assert.ok(inspectText("const answer = 42;").safe);
});

test("security flow: callback history, logs and iteration artifacts omit canaries", async () => {
  const dir = repoC(); const artifactsDir = path.join(dir, "artifacts");
  const secret = "sk-" + "f".repeat(24);
  const captured = []; const rawGates = [];
  let patched = 0;
  const gate = () => {
    const g = gateC(dir, "fixture.test.ts")();
    const raw = Object.freeze({ ...g, ok: false, score: patched ? 3 : 1, failures: Object.freeze([secret]), signature: secret });
    rawGates.push(raw); return raw;
  };
  const result = await supervise({ task: secret, guard: createGuard({ root: dir }), gate, artifactsDir,
    opts: { maxIterations: 2 }, log: (m) => captured.push(m),
    planner: async (input) => { captured.push(input); return { rootCause: secret }; },
    diagnoser: async (input) => { captured.push(input); return { diagnosis: secret }; },
    patcher: async (input) => { captured.push(input); if (patched++) throw new Error(secret); return { ...fix, rationale: secret }; },
  });
  const artifacts = [1, 2].map((n) => readFileSync(path.join(artifactsDir, "iteration-0" + n + ".json"), "utf8"));
  assert.ok(!JSON.stringify({ captured, result, artifacts }).includes(secret), "security flow leaked canary");
  assert.equal(result.iterationCount, 2);
  assert.ok(rawGates.every((g) => !Object.hasOwn(g, "restoredToBest") && g.failures[0] === secret));
});

test("security flow: planner exception and provider retry echo are sanitized", async () => {
  const dir = repoC(); const secret = "sk-" + "g".repeat(24);
  const result = await supervise({ task: "fixture", guard: createGuard({ root: dir }),
    gate: gateC(dir, "fixture.test.ts"), planner: async () => { throw new Error(secret); } });
  assert.ok(result.reason.startsWith("PLAN_FAILED"));
  assert.ok(!JSON.stringify(result).includes(secret));
  const captured = [];
  await auditAskValidated({ system: "fixture", user: secret, timeLeft: 1000,
    ask: async (messages) => { captured.push(messages); return { text: secret, json: { ok: captured.length === 2 } }; },
    validate: (value) => value.ok ? "" : secret,
  });
  assert.equal(captured.length, 2);
  assert.ok(!JSON.stringify(captured).includes(secret), "provider retry leaked canary");
});

test("security persistence: guard preflight and exact diff withholding", async () => {
  const token = Buffer.from("fixture:removed").toString("base64");
  const unsafe = "// Authorization: Basic " + token;
  const dir = repoC({ [PROV]: "export const v = 1;\n" + unsafe + "\n" });
  const guard = createGuard({ root: dir });
  let denied = false;
  try { guard.applyEdits([{ file: REPRO, create: true, new: unsafe }]); }
  catch { denied = true; }
  assert.ok(denied && !existsSync(path.join(dir, REPRO)));
  const gate = gateC(dir, "fixture");
  const result = await supervise({ task: "fixture", guard, gate,
    ...brainC({ patches: [{ edits: [{ file: PROV, old: "export const v = 1;\n" + unsafe, new: "export const v = 2;" }] }] }),
  });
  assert.equal(result.status, "PASS");
  assert.ok(result.diffWithheld && result.diff === null && !result.awaitingApproval);
  assert.ok(!JSON.stringify(result).includes(token), "removed credential escaped the diff boundary");
});

test("baseline parity: reproduction retry, restore and exceptional abort ordering", async () => {
  const base = "d480d38f7de83ec9582dc0be0f2ced23be7537d5";
  const specifier = new URL("./supervisor.mjs", import.meta.url);
  const historical = execFileSync("git", ["show", base + ":scripts/overnight/supervisor.mjs"], {
    cwd: new URL("../..", specifier), encoding: "utf8",
  }).replace(/from "(\.\/[^"]+)"/g, (_, rel) => "from " + JSON.stringify(new URL(rel, specifier).href));
  const { supervise: baselineSupervise } = await import("data:text/javascript;base64," + Buffer.from(historical).toString("base64"));
  const secret = "sk-" + "h".repeat(24);
  for (const scenario of ["reject", "gate", "restore", "null", "getter", "conversion"]) {
    async function trace(invoke) {
      const dir = repoC(); const guard = createGuard({ root: dir });
      const events = []; let calls = 0; let restores = 0;
      const restore = guard.restore;
      guard.restore = (snapshot) => {
        events.push("restore:" + Object.keys(snapshot).length);
        if (++restores === 1 && scenario === "restore") throw new Error(secret);
        return restore(snapshot);
      };
      try {
        const r = await invoke({ task: "fixture", guard, opts: C,
          gate: () => {
            events.push("gate");
            if (++calls === 2) {
              if (scenario === "gate") throw new Error(secret);
              if (scenario === "null") throw null;
              if (scenario === "getter") throw { get message() { throw new Error(secret); } };
              if (scenario === "conversion") throw { message: { toString() { throw new Error(secret); } } };
            }
            return gateC(dir, "")();
          },
          reproducer: async ({ feedback }) => {
            events.push("repro:" + existsSync(path.join(dir, REPRO)));
            if (invoke === supervise) assert.ok(!feedback.includes(secret));
            return { file: REPRO, content: "// fixture\n" };
          },
        });
        events.push(r.status, r.reason.split(":")[0]);
      } catch (error) {
        if (invoke === supervise) assert.ok(error.message === WITHHELD, "abort must emit only fixed text");
        events.push("abort");
      }
      events.push("exists:" + existsSync(path.join(dir, REPRO)));
      return events;
    }
    assert.deepEqual(await trace(supervise), await trace(baselineSupervise), scenario);
  }
});

test("security persistence: CLI report bytes, notifications and whole patch boundary", async () => {
  const dir = repoC(); const secret = "sk-" + "z".repeat(24);
  const guard = createGuard({ root: dir });
  const result = await supervise({ task: secret, guard, gate: gateC(dir, "fixture"),
    ...brainC({ patches: [fix] }),
  });
  const captured = []; const publish = { artifactsDir: dir, profileName: "fixture",
    log: (message) => captured.push(message), notify: (message) => captured.push(message) };
  publishRun({ ...result, task: secret, diff: "unsafe " + secret }, publish);
  const reports = ["report.md", "report.json"].map((name) => readFileSync(path.join(dir, name), "utf8"));
  assert.ok(!existsSync(path.join(dir, "changes.patch")));
  assert.ok(!JSON.stringify({ reports, captured }).includes(secret));
  const clean = mkdtempSync(path.join(tmpdir(), "ovn-publish-"));
  publishRun(result, { ...publish, artifactsDir: clean });
  assert.ok(readFileSync(path.join(clean, "changes.patch"), "utf8") === result.diff, "clean diff bytes changed");
});

test("sanitizer: folded Basic values retain punctuation in plain and JSON text", () => {
  const credential = Buffer.from("fixture:folded-basic").toString("base64");
  for (const gap of ["\r\n ", "\n ", "\r\n\t", "\n\t  ", "\t", "   ", " \r\n \r\n\t"]) {
    for (const prefix of ["Basic", "Authorization: bAsIc"]) {
      const input = prefix + gap + credential + "!?>].:";
      const expected = prefix + gap + "[REDACTED]!?>].:";
      for (const encode of [(value) => value, (value) => JSON.stringify({ header: value }),
        (value) => JSON.stringify({ Authorization: value })]) {
        const checked = inspectText(encode(input));
        assert.ok(!checked.safe && checked.text === encode(expected), "folded Basic token or delimiter mishandled");
        assert.ok(!checked.text.includes(credential), "folded Basic credential leaked");
      }
    }
  }
  for (const text of ["Basic\nA new paragraph.", "Basic\r\nNext line", "Basic\\nNext line",
    "Basic\n  ", "basically\n  harmless", "Authorization: Digest\n  realm=fixture",
    "This is basic authentication guidance.", "Basic authentication guidance",
    "Authorization: Basic authentication guidance"]) {
    assert.ok(inspectText(text).safe, "benign line or empty header was changed");
  }
});

test("sanitizer: folded Basic is screened at source, prompt and diff boundaries", async () => {
  const credential = Buffer.from("fixture:folded-boundaries").toString("base64");
  const header = "Authorization: Basic\r\n \t" + credential + "!";
  const source = "// " + JSON.stringify({ header }) + "\n";
  const dir = repoC(); const guard = createGuard({ root: dir });
  const artifactsDir = path.join(dir, "artifacts");
  const result = await supervise({ task: "fixture", guard, gate: gateC(dir), artifactsDir, opts: C,
    ...brainC({ reproducer: async () => ({ file: REPRO, content: source }) }),
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reproduceAttempts.length, 2);
  assert.ok(result.reproduceAttempts.every((attempt) => attempt.outcome === "ERROR" &&
    attempt.sourceArtifact === null && attempt.sourceSha256 === null && attempt.sourceBytes === 0));
  assert.ok(!existsSync(path.join(dir, REPRO)) && !existsSync(artifactsDir));
  const prompts = [];
  await auditAskValidated({ system: "fixture", user: header, timeLeft: 1000,
    ask: async (messages) => { prompts.push(messages); return { text: "{}", json: {} }; },
    validate: () => "",
  });
  assert.ok(prompts.length === 1 && !JSON.stringify(prompts).includes(credential));
  assert.ok(prompts[0][1].content.endsWith("[REDACTED]!"));
  publishRun({ ...result, diff: "+// " + header }, { artifactsDir: dir, profileName: "fixture", log: () => {} });
  assert.ok(!existsSync(path.join(dir, "changes.patch")));
  for (const name of ["report.md", "report.json"]) {
    assert.ok(!readFileSync(path.join(dir, name), "utf8").includes(credential));
  }
});

test("security persistence: structured credentials and folded diff hunks stay out of artifacts", async () => {
  const structured = JSON.parse(safeJson({
    API_KEY: "fixture-api", accessKey: "fixture-access",
    PRIVATE_KEY: "fixture-private", private_key: "fixture-private-snake",
    SECRET_KEY: "fixture-secret", secretKey: "fixture-secret-camel",
    SIGNING_KEY: "fixture-signing", signingKey: "fixture-signing-camel",
    ordinary: "keep-visible",
  }));
  for (const key of ["API_KEY", "accessKey", "PRIVATE_KEY", "private_key", "SECRET_KEY", "secretKey", "SIGNING_KEY", "signingKey"]) {
    assert.equal(structured[key], "[REDACTED]", key + " must be redacted");
  }
  assert.equal(structured.ordinary, "keep-visible");
  const opaque = "fixtureOpaqueValue42";
  const credential = Buffer.from("fixture:synthetic-patch").toString("base64");
  const dir = repoC();
  const result = await supervise({ task: "fixture", guard: createGuard({ root: dir }),
    gate: gateC(dir, "fixture"), ...brainC({ patches: [fix] }) });
  const header = "diff --git a/x b/x\n--- a/x\n+++ b/x\n";
  const patches = [
    header + "@@ -1,1 +1,2 @@\n-old\n+Authorization: Basic\n+ " + credential + "!\n",
    header + "@@ -1,2 +1,1 @@\n-Authorization: Basic\n- " + credential + ":\n+new\n",
    header + "@@ -1,2 +1,2 @@\n Authorization: Basic\n- gone\n+ " + credential + "\n",
  ];
  assert.ok(isSafePatch(result.diff), "ordinary patch must pass screening");
  for (const diff of patches) {
    assert.ok(!isSafePatch(diff), "folded credential patch passed screening");
    const artifactsDir = mkdtempSync(path.join(tmpdir(), "ovn-folded-diff-"));
    publishRun({ ...result, diff, iterations: [{ nested: { API_KEY: opaque, count: 1 } }] },
      { artifactsDir, profileName: "fixture", log: () => {} });
    const serialized = readFileSync(path.join(artifactsDir, "report.json"), "utf8");
    assert.ok(!existsSync(path.join(artifactsDir, "changes.patch")), "unsafe patch was persisted");
    assert.ok(!serialized.includes(opaque) && !serialized.includes(credential), "credential escaped report writer");
    const nested = JSON.parse(serialized).iterations[0].nested;
    assert.ok(nested.API_KEY === "[REDACTED]" && nested.count === 1, "unexpected structured projection");
  }
});
