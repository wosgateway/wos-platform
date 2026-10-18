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
else if (mode === "nonzero") { process.stderr.write("boom API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123456789 failed"); process.exit(3); }
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
