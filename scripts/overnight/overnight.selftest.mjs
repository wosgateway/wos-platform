import test from "node:test";
import assert from "node:assert/strict";
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
  assert.ok(!scrub("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123").includes("abcdefgh"));
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
