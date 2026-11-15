// Supervisor: task -> [reproduce] -> PLAN (root cause + layer) -> diagnose -> patch -> gate -> analyze -> retry
//             -> PASS (Definition of Done met, STOP for human approval) | BLOCKED | TIMEOUT.
// All side effects (LLM, guard, gate, clock) are injected so the loop is testable without a model.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectText, redact, redactError, safeJson, sanitizeData, WITHHELD } from "./sanitize.mjs";
import { summarizeGate } from "./gate.mjs";
import { layerOf, checkLayerRule } from "./layers.mjs";
import { buildDod, countChangedLines, dirtyPaths, hardcodeViolations, hasSecret, sha256, testLiterals, unrelatedChanges, verifyEvidence } from "./checks.mjs";

const REPRO_SUMMARY_LIMIT = 3000;
const REPRO_FAILURE_LIMIT = 40;
const REPRO_FAILURE_ID_LIMIT = 300;

function reproductionDiagnostics(gate, unitFailures, typecheckFailures) {
  const boundFailures = (failures = []) => {
    const retained = failures.slice(0, REPRO_FAILURE_LIMIT).map(redact);
    return {
      failures: retained.map((id) => id.slice(0, REPRO_FAILURE_ID_LIMIT)),
      omittedFailureCount: failures.length - retained.length,
      truncatedFailureIdCount: retained.filter((id) => id.length > REPRO_FAILURE_ID_LIMIT).length,
    };
  };
  return {
    gate: { ok: gate.ok, score: gate.score, checks: gate.checks.map((check) => {
      const summary = redact(check.summary);
      const bounded = boundFailures(check.failures);
      const omittedSummaryCharacters = Math.max(0, summary.length - REPRO_SUMMARY_LIMIT);
      return {
        name: check.name, status: check.status, summary: summary.slice(0, REPRO_SUMMARY_LIMIT),
        ...bounded, omittedSummaryCharacters,
        truncated: Boolean(omittedSummaryCharacters || bounded.omittedFailureCount || bounded.truncatedFailureIdCount),
      };
    }) },
    unitFailuresInReproFile: boundFailures(unitFailures).failures,
    typecheckFailuresInReproFile: boundFailures(typecheckFailures).failures,
  };
}

function callbackGate(gate) {
  return { ...reproductionDiagnostics(gate, [], []).gate,
    failures: gate.failures.slice(0, 40).map((id) => redact(id).slice(0, REPRO_FAILURE_ID_LIMIT)) };
}

function callbackPlan(plan) {
  return { rootCause: plan.rootCause, layers: plan.layers, _files: plan._files };
}

function callbackDiagnosis(diagnosis) {
  return { diagnosis: diagnosis.diagnosis, failingCause: diagnosis.failingCause, nextApproach: diagnosis.nextApproach, avoid: diagnosis.avoid };
}

export const DEFAULTS = {
  maxIterations: 8, timeoutMs: 6 * 3_600_000, failureLimit: 3, noImproveLimit: 2,
  contract: false,          // enforce layer rule, hard-code guard, evidence check and Definition of Done
  reproduce: false,         // if the baseline is green, write + prove a failing test first
  maxFiles: 3, maxLines: 80, allowLiterals: false,
};

export async function supervise({ task, guard, gate, planner, diagnoser, patcher, reproducer, opts = {}, now = () => Date.now(), log = () => {}, artifactsDir }) {
  try {
    return await superviseRun({ task, guard, gate, planner, diagnoser, patcher, reproducer, opts, now, log, artifactsDir });
  } catch {
    throw new Error(WITHHELD);
  }
}

async function superviseRun({ task, guard, gate, planner, diagnoser, patcher, reproducer, opts, now, log, artifactsDir }) {
  const emit = (message) => log(redact(message));
  const cfg = { ...DEFAULTS, ...opts };
  const startedAt = now();
  const deadline = startedAt + cfg.timeoutMs;
  const runId = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  const iterations = [];
  const reproduceAttempts = [];
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

  emit("Baseline gate...");
  let baseline = gate(guard, { ...cfg.gate, deadline, captureBaseline: true });
  baselineDiffIds = baseline.diffCheckAllIds;
  const baseline0 = baseline;
  let current = baseline;
  let best = { score: baseline.score, iteration: 0, snapshot: {}, gate: baseline };
  const seenSignatures = new Map([[baseline.signature, 0]]);
  let errorStreak = 0, noImprove = 0;
  let plan = null, diagnosis = null, rootCauseProven = false;

  const envProblem = (g) => g.checks.find((c) => c.name === "regression" && c.status === "ENV_ERROR")?.summary.split("\n")[0];
  if (envProblem(baseline)) stop("BLOCKED", `ENVIRONMENT_UNHEALTHY: ${redact(envProblem(baseline))}. Start 'npm run dev' (and check --base-url / the LLM gateway) and run again; nothing was planned or changed.`);

  // ---- Reproduce first: a green baseline is not "done", it is "no evidence yet".
  if (!status && baseline.ok) {
    if (cfg.reproduce && reproducer) {
      let feedback = "";
      for (let attempt = 1; attempt <= 2 && !reproFile && !status; attempt++) {
        const evidence = { attempt, file: null, outcome: "REJECTED", rejectionReason: null, feedbackSent: feedback, feedbackForNextAttempt: "", gate: null, sourceArtifact: null, sourceSha256: null, sourceBytes: 0 };
        let restoring = false;
        try {
          emit(`Baseline is green: writing a reproducing test (attempt ${attempt})...`);
          const r = await reproducer(sanitizeData({ task, feedback, timeLeft: timeLeft() }));
          evidence.file = r?.file == null ? null : redact(r.file);
          if (!/(\.test\.|\.spec\.)/i.test(r.file ?? "")) {
            throw new Error(`REPRO_FILE_RULE: reproducer may create only a test/spec file, got '${r.file ?? ""}'`);
          }
          const applied = guard.applyEdits([{ file: r.file, create: true, new: r.content }]);
          remember(applied);
          const file = applied[0].file;
          evidence.file = redact(file);
          const source = applied[0].after;
          if (typeof source === "string" && inspectText(source).safe) {
            evidence.sourceSha256 = sha256(source);
            evidence.sourceBytes = Buffer.byteLength(source, "utf8");
            if (artifactsDir) {
              const artifact = `repro-attempt-${String(attempt).padStart(2, "0")}.test-source.txt`;
              try {
                mkdirSync(artifactsDir, { recursive: true });
                writeFileSync(path.join(artifactsDir, artifact), source, { flag: "wx" });
                evidence.sourceArtifact = artifact;
              } catch (e) { evidence.sourceArtifactError = redactError(e).slice(0, 300); }
            }
          }
          const g = gate(guard, gateOpts());
          const unit = g.checks.find((c) => c.name === "unit");
          const tsc = g.checks.find((c) => c.name === "typecheck");
          const fails = unit?.failures.some((f) => f.startsWith(`${file}::`)) && !tsc?.failures.some((f) => f.startsWith(`${file}::`));
          const unitFailures = unit?.failures.filter((f) => f.startsWith(`${file}::`)) ?? [];
          const typecheckFailures = tsc?.failures.filter((f) => f.startsWith(`${file}::`)) ?? [];
          Object.assign(evidence, reproductionDiagnostics(g, unitFailures, typecheckFailures));
          if (fails) {
            reproFile = file; baseline = g; current = g;
            const snapshot = guard.snapshotTouched();
            evidence.outcome = "REPRODUCED";
            best = { score: g.score, iteration: 0, snapshot, gate: g };
            seenSignatures.set(g.signature, 0);
            emit(`Reproduced: ${evidence.file} fails as expected.`);
          } else {
            evidence.rejectionReason = typecheckFailures.length ? "TYPECHECK_FAILED_IN_REPRO_FILE" : g.ok ? "TEST_PASSED" : "NO_UNIT_FAILURE_ATTRIBUTED_TO_REPRO_FILE";
            feedback = redact(g.ok ? "the test PASSED, so it does not reproduce the bug; assert the CORRECT expected behaviour that the current code violates" : "the test file has a type error or fails for the wrong reason; fix the test itself");
            restoring = true;
            guard.restore({ [file]: null }); delete baselineFiles[file]; guard.touched.delete(file);
          }
        } catch (e) {
          evidence.outcome = "ERROR";
          const message = redact(String(e.message));
          evidence.rejectionReason = message.slice(0, 1200);
          if (restoring) evidence.cleanupError = message.slice(0, 500);
          feedback = message.slice(0, 300);
          emit(`reproduce attempt ${attempt} failed: ${feedback}`);
        }
        evidence.feedbackForNextAttempt = feedback;
        reproduceAttempts.push(evidence);
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
        const p = await planner(sanitizeData({ task, baseline: callbackGate(baseline), feedback, timeLeft: timeLeft() }));
        if (cfg.contract) {
          const problem = verifyEvidence(guard, p);
          if (problem) { feedback = redact(problem); if (attempt === 2) stop("BLOCKED", `PLAN_REJECTED: root cause not proven - ${feedback}`); continue; }
        }
        plan = p;
        rootCauseProven = cfg.contract; // evidence was checked against the ORIGINAL source (before any patch)
      } catch (e) { stop("BLOCKED", `PLAN_FAILED: ${redactError(e)}`); }
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
        diagnosis = await diagnoser(sanitizeData({ task, plan: callbackPlan(plan), gate: callbackGate(current), history: iterations.slice(0, -1), timeLeft: timeLeft() }));
        if (!diagnosis || !String(diagnosis.diagnosis ?? "").trim()) throw new Error("diagnoser returned no diagnosis; refusing to patch blind");
        it.diagnosis = sanitizeData(callbackDiagnosis(diagnosis));
      }
      const patch = await patcher(sanitizeData({ task, plan: callbackPlan(plan), diagnosis: callbackDiagnosis(diagnosis), gate: callbackGate(current), history: iterations.slice(0, -1), timeLeft: timeLeft() }));
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
      it.files = applied.map((a) => redact(a.file));
      it.rationale = redact(patch.rationale);
      errorStreak = 0;
    } catch (e) {
      const msg = redact(String(e.message)).replace(/\s+/g, " ").slice(0, 400);
      it.note = `ERROR: ${msg}`;
      errorStreak++;
      emit(`iteration ${i}: ${it.note} (error streak ${errorStreak}/${cfg.failureLimit})`);
      saveIteration(artifactsDir, it);
      if (now() >= deadline) { stop("TIMEOUT", "deadline reached"); break; }
      if (errorStreak >= cfg.failureLimit) stop("BLOCKED", `FAILURE_LIMIT: ${errorStreak} consecutive errored iterations (last: ${msg})`);
      continue;
    }

    if (now() >= deadline) { stop("TIMEOUT", "deadline reached after patch, before gate"); break; }
    const g = gate(guard, gateOpts());
    it.gate = { ok: g.ok, score: g.score, summary: summarizeGate(g), failures: callbackGate(g).failures, checks: g.checks.map((c) => ({ name: c.name, status: c.status })) };
    emit(`iteration ${i}: ${it.gate.summary}`);
    saveIteration(artifactsDir, it);

    if (envProblem(g)) { current = g; stop("BLOCKED", `ENVIRONMENT_UNHEALTHY: ${redact(envProblem(g))} (during iteration ${i}); the tree was restored to the best known state`); break; }
    const patched = Object.keys(baselineFiles).some((f) => f !== reproFile);
    if (g.ok && patched) { current = g; stop("PASS", "all required gates green"); break; }
    if (g.ok) { current = g; stop("BLOCKED", "gate green but no production file changed"); break; }
    if (now() >= deadline) { current = g; stop("TIMEOUT", "deadline reached after gate"); break; }

    const repeated = seenSignatures.has(g.signature);
    seenSignatures.set(g.signature, i);
    let restoredToBest = false;
    if (g.score < best.score) {
      best = { score: g.score, iteration: i, snapshot: guard.snapshotTouched(), gate: g };
      noImprove = 0;
      it.progress = "improved";
    } else {
      noImprove++;
      it.progress = repeated ? "repeated-failure" : g.score > best.score ? "worse" : "no-improvement";
      if (g.score > best.score) { restoreBest(guard, baselineFiles, best); restoredToBest = true; } // never build on a regression
    }
    current = restoredToBest ? best.gate : g;
    if (noImprove >= cfg.noImproveLimit) { stop("BLOCKED", `NO_IMPROVEMENT: ${noImprove} consecutive iterations without fewer failures (best=${best.score} at iteration ${best.iteration})`); break; }
  }

  if (!status) stop("BLOCKED", `MAX_ITERATIONS: ${cfg.maxIterations} reached without a green gate`);
  if (status !== "PASS" && Object.keys(baselineFiles).length) restoreBest(guard, baselineFiles, best);

  // ---- Evidence for the "no commit / push / deploy" claims, and the final diff.
  const head1 = git(["rev-parse", "HEAD"]).output.trim();
  const staged1 = git(["diff", "--cached", "--name-only"]).output.trim();
  const changed = Object.keys(baselineFiles).filter((f) => guard.read(f) !== baselineFiles[f]);
  const tracked = Object.keys(baselineFiles).length
    ? git(["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--", ...Object.keys(baselineFiles)])
    : { ok: true, stdout: "" };
  const created = changed.filter((f) => baselineFiles[f] === null).map((f) => `--- new file: ${f} ---\n${guard.read(f)}`);
  const diffText = `${tracked.ok ? tracked.stdout : ""}${created.length ? `\n${created.join("\n")}` : ""}`;

  const diffSafe = tracked.ok && inspectText(diffText).safe;
  const result = {
    runId, task, status, reason,
    iterations, iterationCount: iterations.length,
    filesChanged: changed,
    files: changed.flatMap((f) => {
      const source = guard.read(f);
      return inspectText(f).safe && inspectText(source).safe
        ? [{ path: f, sha256: sha256(source), created: baselineFiles[f] === null }]
        : [];
    }),
    reproFile,
    reproduceAttempts,
    plan: plan ? { rootCause: plan.rootCause, layers: plan.layers ?? [], multiLayerReason: plan.multiLayerReason ?? "", evidence: plan.evidence ?? [] } : null,
    baseline: { ok: baseline0.ok, score: baseline0.score, summary: summarizeGate(baseline0), failures: callbackGate(baseline0).failures },
    final: { ok: current.ok, score: current.score, summary: summarizeGate(current), checks: current.checks.map((c) => ({ name: c.name, status: c.status })) },
    commit: head0 === head1 && staged0 === staged1 ? "NONE" : "UNEXPECTED_CHANGE",
    push: "NONE", deploy: "NONE",
    guardViolations: guard.violations.slice(),
    durationMs: now() - startedAt,
    diff: diffSafe ? diffText : null,
    ...(diffSafe ? {} : { diffWithheld: true }),
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
  result.awaitingApproval = result.status === "PASS" && diffSafe;
  const { diff, ...output } = result;
  return { ...sanitizeData(output), diff };
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
    writeFileSync(path.join(dir, `iteration-${String(it.n).padStart(2, "0")}.json`), safeJson(it));
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
    ...(r.reproduceAttempts?.length ? ["Reproduction attempts:", ...r.reproduceAttempts.map((a) => `  #${a.attempt} ${a.outcome} - ${a.rejectionReason ?? "confirmed failing test"} (file: ${a.file || "n/a"}; source: ${a.sourceArtifact ?? "not saved"})`)] : []),
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
    ...(r.diffWithheld ? ["Patch artifact withheld by security screening."] : []),
    ...(r.awaitingApproval ? ["", "WAITING FOR APPROVAL - nothing is staged or committed. Review with: git diff"] : []),
  ].join("\n");
}
