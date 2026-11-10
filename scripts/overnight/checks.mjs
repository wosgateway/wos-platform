// Architecture / safety checks that go beyond "the tests are green".
import { createHash } from "node:crypto";
import { layerOf } from "./layers.mjs";
import { SECRET_IN_TEXT } from "./guard.mjs";

const THAI_LAO = /[฀-๿຀-໿]/;
const decode = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** Customer-sentence-like string literals (Thai/Lao, >=5 chars) found in test sources. */
export function testLiterals(sources) {
  const out = new Set();
  for (const src of sources) {
    for (const m of String(src ?? "").matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])+)\1/g)) {
      const lit = decode(m[2]);
      if (lit.length >= 5 && THAI_LAO.test(lit)) out.add(lit);
    }
  }
  return out;
}

export function addedLines(edit) {
  const oldSet = new Set(String(edit.old ?? "").split("\n").map((l) => l.trim()));
  return String(edit.new ?? "").split("\n").filter((l) => l.trim() && !oldSet.has(l.trim()));
}

/** A keyword patch = production code that quotes a whole test sentence as a literal. */
export function hardcodeViolations(edits, literals) {
  const bad = [];
  for (const e of edits) {
    if (layerOf(e.file) === "test") continue;
    for (const line of addedLines(e).map(decode)) {
      for (const lit of literals) {
        if (["'", '"', "`"].some((q) => line.includes(q + lit + q))) bad.push({ file: e.file, literal: lit });
      }
    }
  }
  return bad;
}

export function countChangedLines(files) {
  let added = 0, removed = 0;
  for (const f of files) {
    if (layerOf(f.file) === "test") continue;
    const a = String(f.before ?? "").split("\n"), b = String(f.after ?? "").split("\n");
    const sa = new Map(), sb = new Map();
    for (const l of a) sa.set(l, (sa.get(l) ?? 0) + 1);
    for (const l of b) sb.set(l, (sb.get(l) ?? 0) + 1);
    for (const [l, n] of sb) added += Math.max(0, n - (sa.get(l) ?? 0));
    for (const [l, n] of sa) removed += Math.max(0, n - (sb.get(l) ?? 0));
  }
  return { added, removed, total: added + removed };
}

export function dirtyPaths(guard) {
  const r = guard.exec("git", ["status", "--porcelain", "--untracked-files=all"], { timeoutMs: 30_000 });
  if (!r.ok) return null;
  return new Set(r.stdout.split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, "")));
}
const IGNORABLE = /^(\.overnight\/|\.next\/|next-env\.d\.ts$|.*\.tsbuildinfo$)/;
export function unrelatedChanges(before, after, touched) {
  if (!before || !after) return null;
  return [...after].filter((p) => !before.has(p) && !touched.has(p) && !IGNORABLE.test(p));
}

/** "Root cause proven": every evidence {file, symbol} must exist and contain the symbol. */
export function verifyEvidence(guard, plan) {
  const ev = Array.isArray(plan?.evidence) ? plan.evidence : [];
  if (!ev.length) return "plan gives no evidence (file + symbol) for the root cause";
  for (const e of ev) {
    const src = e && typeof e.file === "string" ? guard.read(e.file) : null;
    if (src == null) return `evidence file not found or unreadable: ${e?.file}`;
    if (typeof e.symbol !== "string" || !e.symbol.trim() || !src.includes(e.symbol)) return `evidence symbol '${e?.symbol}' not found in ${e.file}`;
  }
  return "";
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const hasSecret = (text) => SECRET_IN_TEXT.test(String(text ?? ""));

/** Definition of Done. state: ok | fail | skipped. */
export function buildDod(i) {
  const row = (id, label, state, detail = "") => ({ id, label, state, detail });
  return [
    row("root-cause", "Root cause proven (evidence verified in source)", i.rootCauseOk ? "ok" : "fail", i.rootCauseDetail),
    row("minimal", `Minimal patch (<= ${i.maxFiles} files, <= ${i.maxLines} changed lines)`, i.minimalOk ? "ok" : "fail", i.minimalDetail),
    row("layer", "Fixed in the owning layer (no hard-coded test sentences)", i.layerOk ? "ok" : "fail", i.layerDetail),
    row("target", "Target test passes", i.targetOk ? "ok" : "fail"),
    row("regression", "Existing regression passes", i.regression === "PASS" ? "ok" : i.regression === "SKIPPED" ? "skipped" : "fail", i.regression),
    row("typecheck", "TypeScript passes", i.typecheck === "PASS" ? "ok" : "fail"),
    row("build", "Build passes", i.build === "PASS" ? "ok" : i.build === "SKIPPED" ? "skipped" : "fail", i.build),
    row("unrelated", "No unrelated files changed", i.unrelated === null ? "skipped" : i.unrelated.length ? "fail" : "ok", (i.unrelated ?? []).join(", ")),
    row("secrets", "No secrets in the diff", i.secretsOk ? "ok" : "fail"),
    row("git", "No git commit / push / deploy", i.gitOk ? "ok" : "fail"),
  ];
}
