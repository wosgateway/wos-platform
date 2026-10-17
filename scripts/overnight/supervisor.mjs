// Supervisor: task -> [reproduce] -> PLAN (root cause + layer) -> diagnose -> patch -> gate -> analyze -> retry
//             -> PASS (Definition of Done met, STOP for human approval) | BLOCKED | TIMEOUT.
// All side effects (LLM, guard, gate, clock) are injected so the loop is testable without a model.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { summarizeGate } from "./gate.mjs";
import { layerOf, checkLayerRule } from "./layers.mjs";
import { buildDod, countChangedLines, dirtyPaths, hardcodeViolations, hasSecret, sha256, testLiterals, unrelatedChanges, verifyEvidence } from "./checks.mjs";

export const DEFAULTS = {
  maxIterations: 8, timeoutMs: 6 * 3_600_000, failureLimit: 3, noImproveLimit: 2,
  contract: false,          // enforce layer rule, hard-code guard, evidence check and Definition of Done
  reproduce: false,         // if the baseline is green, write + prove a failing test first
  maxFiles: 3, maxLines: 80, allowLiterals: false,
};

export async function supervise({ task, guard, gate, planner, diagnoser, patcher, reproducer, opts = {}, now = () => Date.now(), log = () => {}, artifactsDir }) {
  const cfg = { ...DEFAULTS, ...opts };
  const startedAt = now();
  const deadline = startedAt + cfg.timeoutMs;
  const runId = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  const iterations = [];
  const baselineFiles = {};       // rel -> content before the agent's first touch (null = did not exist)
  let status = null, reason = "", reproFile = null;

  const git = (args) => guard.exec("git", args, { timeoutMs: 30_000 });
  const head0 = git(["rev-parse", "HEAD"]).output.trim();
  const staged0 = git(["diff", "--cached", "--name-only"]).output.trim();
  const dirty0 = cfg.contract ? dirtyPaths(guard) : null;

  let baselineDiffIds = new Set();
  const gateOpts = () => ({ ...cfg.gate, deadline, baselineDiffIds });
  const timeLeft = () => deadline - now();
  const stop = (s, r) => { status = s; reason = r; };
  const remember = (applied) => { for (const a of applied) if (!(a.file in baselineFiles)) baselineFiles[a.file] = a.before; };

  log("Baseline gate...");
  let baseline = gate(guard, { ...cfg.gate, deadline, captureBaseline: true });
  baselineDiffIds = baseline.diffCheckAllIds;
  const baseline0 = baseline;
  let current = baseline;
  let best = { score: baseline.score, iteration: 0, snapshot: {}, gate: baseline };
  const seenSignatures = new Map([[baseline.signature, 0]]);
  let errorStreak = 0, noImprove = 0;
  let plan = null, diagnosis = null, rootCauseProven = false;

  const envProblem = (g) => g.checks.find((c) => c.name === "regression" && c.status === "ENV_ERROR")?.summary.split("\n")[0];
  if (envProblem(baseline)) stop("BLOCKED", `ENVIRONMENT_UNHEALTHY: ${envProblem(baseline)}. Start 'npm run dev' (and check --base-url / the LLM gateway) and run again; nothing was planned or changed.`);

  // ---- Reproduce first: a green baseline is not "done", it is "no evidence yet".
  if (!status && baseline.ok) {
    if (cfg.reproduce && reproducer) {
      let feedback = "";
      for (let attempt = 1; attempt <= 2 && !reproFile && !status; attempt++) {
        try {
          log(`Baseline is green: writing a reproducing test (attempt ${attempt})...`);
          const r = await reproducer({ task, feedback, timeLeft: timeLeft() });
          if (!/(\.test\.|\.spec\.)/i.test(r.file ?? "")) {
            throw new Error(`REPRO_FILE_RULE: reproducer may create only a test/spec file, got '${r.file ?? ""}'`);
          }
          const applied = guard.applyEdits([{ file: r.file, create: true, new: r.content }]);
          remember(applied);
          const file = applied[0].file;
          const g = gate(guard, gateOpts());
          const unit = g.checks.find((c) => c.name === "unit");
          const tsc = g.checks.find((c) => c.name === "typecheck");
          const fails = unit?.failures.some((f) => f.startsWith(`${file}::`)) && !tsc?.failures.some((f) => f.startsWith(`${file}::`));
          if (fails) { reproFile = file; baseline = g; current = g; best = { score: g.score, iteration: 0, snapshot: guard.snapshotTouched(), gate: g }; seenSignatures.set(g.signature, 0); log(`Reproduced: ${file} fails as expected.`); }
          else {
            feedback = g.ok ? "the test PASSED, so it does not reproduce the bug; assert the CORRECT expected behaviour that the current code violates" : "the test file has a type error or fails for the wrong reason; fix the test itself";
            guard.restore({ [file]: null }); delete baselineFiles[file]; guard.touched.delete(file);
          }
        } catch (e) { feedback = String(e.message).slice(0, 300); log(`reproduce attempt ${attempt} failed: ${feedback}`); }
      }
      if (!reproFile && !status) stop("BLOCKED", `CANNOT_REPRODUCE: could not write a test that fails for the reported problem (${feedback}). The bug may already be fixed, or the task needs a concrete failing example.`);
    } else if (!cfg.allowGreenBaseline) {
      stop("BLOCKED", "NO_FAILING_EVIDENCE: baseline is already green, so there is no failing test to drive a fix. Add a failing regression/unit case first (or use ai:agent, which reproduces first).");
    }
  }

  // ---- Plan: root cause + owning layer + verifiable evidence.
  if (!status) {
    let feedback = "";
    for (let attempt = 1; attempt <= 2 && !plan && !status; attempt++) {
      try {
        const p = await planner({ task, baseline, feedback, timeLeft: timeLeft() });
        if (cfg.contract) {
          const problem = verifyEvidence(guard, p);
          if (problem) { feedback = problem; if (attempt === 2) stop("BLOCKED", `PLAN_REJECTED: root cause not proven - ${problem}`); continue; }
        }
        plan = p;
        rootCauseProven = cfg.contract; // evidence was checked against the ORIGINAL source (before any patch)
      } catch (e) { stop("BLOCKED", `PLAN_FAILED: ${e.message}`); }
    }
  }

  const testSources = () => {
    const files = new Set([...current.failures.map((f) => String(f).split("::")[0]), ...(reproFile ? [reproFile] : [])]);
    return [...[...files].map((f) => guard.read(f)), task];
  };

  for (let i = 1; !status && i <= cfg.maxIterations; i++) {
    if (now() >= deadline) { stop("TIMEOUT", "deadline reached before next iteration"); break; }
    const it = { n: i, startedAt: now(), files: [], gate: null, note: "" };
    iterations.push(it);
    try {
      // Diagnose BEFORE patching: no random edits.
      if (!current.ok || i === 1) {
        diagnosis = await diagnoser({ task, plan, gate: current, history: iterations.slice(0, -1), timeLeft: timeLeft() });
        if (!diagnosis || !String(diagnosis.diagnosis ?? "").trim()) throw new Error("diagnoser returned no diagnosis; refusing to patch blind");
        it.diagnosis = diagnosis;
      }
      const patch = await patcher({ task, plan, diagnosis, gate: current, history: iterations.slice(0, -1), timeLeft: timeLeft() });
      if (cfg.contract) {
        const edited = patch.edits.map((e) => e.file);
        const layerProblem = checkLayerRule(edited, plan);
        if (layerProblem) throw new Error(`LAYER_RULE: ${layerProblem}`);
        const nonTest = new Set([...guard.touched, ...edited].filter((f) => layerOf(f) !== "test"));
        if (nonTest.size > cfg.maxFiles) throw new Error(`MINIMAL_RULE: patch would change ${nonTest.size} non-test files (max ${cfg.maxFiles})`);
        if (!cfg.allowLiterals) {
          const bad = hardcodeViolations(patch.edits, testLiterals(testSources()));
          if (bad.length) throw new Error(`HARDCODE_GUARD: production code quotes a test sentence (${bad.map((b) => `'${b.literal}' in ${b.file}`).join("; ")}). Fix the logic in the owning layer instead of matching the sentence.`);
        }
      }
      const applied = guard.applyEdits(patch.edits);
      remember(applied);
      it.files = applied.map((a) => a.file);
      it.rationale = patch.rationale ?? "";
      errorStreak = 0;
    } catch (e) {
      const msg = String(e.message).replace(/\s+/g, " ").slice(0, 400);
      it.note = `ERROR: ${msg}`;
      errorStreak++;
      log(`iteration ${i}: ${it.note} (error streak ${errorStreak}/${cfg.failureLimit})`);
      saveIteration(artifactsDir, it);
      if (now() >= deadline) { stop("TIMEOUT", "deadline reached"); break; }
      if (errorStreak >= cfg.failureLimit) stop("BLOCKED", `FAILURE_LIMIT: ${errorStreak} consecutive errored iterations (last: ${msg})`);
      continue;
    }

    if (now() >= deadline) { stop("TIMEOUT", "deadline reached after patch, before gate"); break; }
    const g = gate(guard, gateOpts());
    it.gate = { ok: g.ok, score: g.score, summary: summarizeGate(g), failures: g.failures.slice(0, 40), checks: g.checks.map((c) => ({ name: c.name, status: c.status })) };
    log(`iteration ${i}: ${it.gate.summary}`);
    saveIteration(artifactsDir, it);

    if (envProblem(g)) { current = g; stop("BLOCKED", `ENVIRONMENT_UNHEALTHY: ${envProblem(g)} (during iteration ${i}); the tree was restored to the best known state`); break; }
    const patched = Object.keys(baselineFiles).some((f) => f !== reproFile);
    if (g.ok && patched) { current = g; stop("PASS", "all required gates green"); break; }
    if (g.ok) { current = g; stop("BLOCKED", "gate green but no production file changed"); break; }
    if (now() >= deadline) { current = g; stop("TIMEOUT", "deadline reached after gate"); break; }

    const repeated = seenSignatures.has(g.signature);
    seenSignatures.set(g.signature, i);
    if (g.score < best.score) {
      best = { score: g.score, iteration: i, snapshot: guard.snapshotTouched(), gate: g };
      noImprove = 0;
      it.progress = "improved";
    } else {
      noImprove++;
      it.progress = repeated ? "repeated-failure" : g.score > best.score ? "worse" : "no-improvement";
      if (g.score > best.score) { restoreBest(guard, baselineFiles, best); g.restoredToBest = true; } // never build on a regression
    }
    current = g.restoredToBest ? best.gate : g;
    if (noImprove >= cfg.noImproveLimit) { stop("BLOCKED", `NO_IMPROVEMENT: ${noImprove} consecutive iterations without fewer failures (best=${best.score} at iteration ${best.iteration})`); break; }
  }

  if (!status) stop("BLOCKED", `MAX_ITERATIONS: ${cfg.maxIterations} reached without a green gate`);
  if (status !== "PASS" && Object.keys(baselineFiles).length) restoreBest(guard, baselineFiles, best);

  // ---- Evidence for the "no commit / push / deploy" claims, and the final diff.
  const head1 = git(["rev-parse", "HEAD"]).output.trim();
  const staged1 = git(["diff", "--cached", "--name-only"]).output.trim();
  const changed = Object.keys(baselineFiles).filter((f) => guard.read(f) !== baselineFiles[f]);
  const tracked = git(["diff", "--no-color", "--", ...Object.keys(baselineFiles)]);
  const created = changed.filter((f) => baselineFiles[f] === null).map((f) => `--- new file: ${f} ---\n${guard.read(f)}`);
  const diffText = `${tracked.ok ? tracked.stdout : ""}${created.length ? `\n${created.join("\n")}` : ""}`;

  const result = {
    runId, task, status, reason,
    iterations, iterationCount: iterations.length,
    filesChanged: changed,
    files: changed.map((f) => ({ path: f, sha256: sha256(guard.read(f) ?? ""), created: baselineFiles[f] === null })),
    reproFile,
    plan: plan ? { rootCause: plan.rootCause, layers: plan.layers ?? [], multiLayerReason: plan.multiLayerReason ?? "", evidence: plan.evidence ?? [] } : null,
    baseline: { ok: baseline0.ok, score: baseline0.score, summary: summarizeGate(baseline0), failures: baseline0.failures.slice(0, 40) },
    final: { ok: current.ok, score: current.score, summary: summarizeGate(current), checks: current.checks.map((c) => ({ name: c.name, status: c.status })) },
    commit: head0 === head1 && staged0 === staged1 ? "NONE" : "UNEXPECTED_CHANGE",
    push: "NONE", deploy: "NONE",
    guardViolations: guard.violations.slice(),
    durationMs: now() - startedAt,
    diff: diffText,
  };
  if (result.commit !== "NONE") { result.status = "BLOCKED"; result.reason = "SAFETY: HEAD or staged files changed during the run"; }
  result.push = result.commit === "NONE" ? "NONE" : "CHECK_MANUALLY";

  // ---- Definition of Done: green tests are necessary, not sufficient.
  if (cfg.contract && result.status === "PASS") {
    const checkOf = (n, d) => current.checks.find((c) => c.name === n)?.status ?? d;
    const nonTest = changed.filter((f) => layerOf(f) !== "test");
    const stats = countChangedLines(changed.map((f) => ({ file: f, before: baselineFiles[f], after: guard.read(f) })));
    const layerProblem = checkLayerRule(changed, plan);
    const unrelated = unrelatedChanges(dirty0, dirtyPaths(guard), new Set(Object.keys(baselineFiles)));
    result.dod = buildDod({
      rootCauseOk: rootCauseProven, rootCauseDetail: rootCauseProven ? "evidence checked in the original source before patching" : "no verified evidence",
      maxFiles: cfg.maxFiles, maxLines: cfg.maxLines,
      minimalOk: nonTest.length >= 1 && nonTest.length <= cfg.maxFiles && stats.total <= cfg.maxLines,
      minimalDetail: `${nonTest.length} production file(s), +${stats.added}/-${stats.removed} lines`,
      layerOk: !layerProblem, layerDetail: layerProblem,
      targetOk: current.ok, regression: checkOf("regression", "NOT_RUN"), typecheck: checkOf("typecheck", "NOT_RUN"), build: checkOf("build", "SKIPPED"),
      unrelated, secretsOk: !hasSecret(diffText), gitOk: result.commit === "NONE",
    });
    const failed = result.dod.filter((d) => d.state === "fail");
    if (failed.length) { result.status = "BLOCKED"; result.reason = `DOD_FAILED: ${failed.map((d) => d.id).join(", ")} (tests are green but the change is not acceptable as-is; the tree is left as the agent produced it for your review)`; }
  }
  result.awaitingApproval = result.status === "PASS";
  return result;
}

function restoreBest(guard, baselineFiles, best) {
  const target = {};
  for (const rel of Object.keys(baselineFiles)) target[rel] = rel in best.snapshot ? best.snapshot[rel] : baselineFiles[rel];
  guard.restore(target);
}

function saveIteration(dir, it) {
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `iteration-${String(it.n).padStart(2, "0")}.json`), JSON.stringify(it, null, 2));
  } catch { /* artifacts are best-effort */ }
}

export function fingerprint(s) { return createHash("sha256").update(s).digest("hex").slice(0, 12); }

export function formatReport(r) {
  const checkOf = (name) => r.final.checks.find((c) => c.name === name)?.status ?? "NOT_RUN";
  const verdict = r.status === "PASS" ? "READY FOR HUMAN REVIEW" : r.status === "TIMEOUT" ? "TIMED OUT - HUMAN REVIEW NEEDED" : "BLOCKED - HUMAN DECISION NEEDED";
  const icon = { PASS: "âœ…", BLOCKED: "ðŸ›‘", TIMEOUT: "â±" }[r.status];
  const mins = (r.durationMs / 60000).toFixed(1);
  const mark = { ok: "âœ“", fail: "âœ—", skipped: "âš " };
  return [
    `${icon} ${r.status}`, "",
    "OVERNIGHT RESULT", "----------------",
    `Task: ${r.task}`,
    `Reason: ${r.reason}`,
    ...(r.plan?.rootCause ? [`Root cause: ${r.plan.rootCause}`, `Layer: ${(r.plan.layers ?? []).join(", ") || "n/a"}`] : []),
    ...(r.reproFile ? [`Reproducing test: ${r.reproFile}`] : []),
    `Iterations: ${r.iterationCount}`,
    `Duration: ${mins} min`,
    `Files changed: ${r.filesChanged.length}${r.filesChanged.length ? ` (${r.filesChanged.join(", ")})` : ""}`,
    `Typecheck: ${checkOf("typecheck")}`,
    `Unit tests: ${checkOf("unit")}`,
    `Regression: ${checkOf("regression")}`,
    `Diff check: ${checkOf("diff-check")}`,
    `Commit: ${r.commit}`,
    `Push: ${r.push}`,
    `Deploy: ${r.deploy}`,
    `Guard violations blocked: ${r.guardViolations.length}`,
    `Status: ${verdict}`,
    ...(r.dod ? ["", "Definition of Done:", ...r.dod.map((d) => `  [${mark[d.state]}] ${d.label}${d.detail ? ` - ${d.detail}` : ""}`)] : []),
    ...(r.status !== "PASS" && r.baseline.failures.length
      ? ["", `Baseline failures (${r.baseline.failures.length}, before any patch):`, ...r.baseline.failures.slice(0, 12).map((f) => `  - ${f}`)]
      : []),
    ...(r.awaitingApproval ? ["", "WAITING FOR APPROVAL - nothing is staged or committed. Review with: git diff"] : []),
  ].join("\n");
}
