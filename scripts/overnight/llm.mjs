// LLM-backed planner / diagnoser / patcher. The model only proposes; guard + gate decide.
import { readFileSync } from "node:fs";
import { scrub } from "./guard.mjs";
import { LAYERS } from "./layers.mjs";

const CONTRACT = (() => { try { return readFileSync(new URL("./contract.md", import.meta.url), "utf8"); } catch { return ""; } })();

const env = (n) => process.env[n]?.trim()?.replace(/^["']|["']$/g, "") || undefined;

async function client() {
  const { default: OpenAI } = await import("openai");
  const apiKey = env("LITELLM_API_KEY") || env("OPENAI_API_KEY");
  if (!apiKey) throw new Error("LITELLM_API_KEY/OPENAI_API_KEY is not configured");
  const baseURL = env("LITELLM_BASE_URL");
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), maxRetries: 0 });
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);
export const isRetryable = (e) => RETRYABLE_STATUS.has(e?.status) || /ETIMEDOUT|ECONNRESET|socket hang up|timed? ?out/i.test(String(e?.message ?? ""));

// Retry transient gateway errors (e.g. Cloudflare 524) with backoff. Time-bounded by the caller's deadline.
export async function withRetry(fn, { tries = 4, baseMs = 20_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeLeft = () => Infinity } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const wait = baseMs * 2 ** i;
      if (!isRetryable(e) || i === tries - 1 || timeLeft() < wait + 30_000) throw e;
      await sleep(wait);
    }
  }
  throw last;
}

// Streaming keeps bytes flowing, so a proxy with a 100-120s "first response" limit (Cloudflare 524) does not cut us off.
async function askJsonOnce(messages, timeLeft, model) {
  const c = await client();
  const started = Date.now();
  const text = await withRetry(async () => {
    const stream = await c.chat.completions.create(
      { model: model || env("WOS_AI_AGENT_MODEL") || env("LITELLM_MODEL") || "gpt-5.6-luna", temperature: 0, response_format: { type: "json_object" }, messages, stream: true },
      { timeout: Math.max(10_000, Math.min(600_000, timeLeft - (Date.now() - started))) },
    );
    let out = "";
    for await (const chunk of stream) out += chunk.choices?.[0]?.delta?.content ?? "";
    if (!out.trim()) throw Object.assign(new Error("LLM returned an empty stream"), { status: 502 });
    return out;
  }, { timeLeft: () => timeLeft - (Date.now() - started) });
  try { return { text, json: JSON.parse(text) }; }
  catch { const m = text.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) return { text, json: JSON.parse(m[1]) }; throw new Error("LLM did not return valid JSON"); }
}

// Ask, validate, and if the model echoed the schema / returned junk, tell it exactly what was wrong and ask once more.
export async function askValidated({ system, user, timeLeft, model, validate, ask = askJsonOnce, attempts = 2 }) {
  let messages = [{ role: "system", content: system }, { role: "user", content: user }];
  let lastProblem = "";
  for (let i = 0; i < attempts; i++) {
    const { text, json } = await ask(messages, timeLeft, model);
    const problem = validate(json);
    if (!problem) return json;
    lastProblem = `${problem}. Model returned: ${scrub(text).slice(0, 400)}`;
    messages = [...messages, { role: "assistant", content: text },
      { role: "user", content: `INVALID: ${problem}. You returned the schema description or placeholder text instead of real content. Answer again with REAL values derived from the source files above, as one JSON object.` }];
  }
  throw new Error(lastProblem);
}

const PLACEHOLDER = /concrete mechanism|<string>|exact existing text|full content|^path$|^string$|new\/path\.ts/i;
const isReal = (v, min = 1) => typeof v === "string" && v.trim().length >= min && !PLACEHOLDER.test(v.trim());

const RULES = [
  "You are the engineering brain of the WOS Overnight Agent working on a Next.js/TypeScript repo.",
  "HARD RULES: never git add/commit/push, never deploy, never touch .env/secrets/production/migrations/package files, never edit existing tests to make them pass.",
  "Fix the product code, not the test. Prefer the smallest change. Do not invent behaviour that the source does not support.",
  "Return ONLY one JSON object.",
].join("\n");

function windows(content, terms, maxBytes) {
  if (Buffer.byteLength(content) <= maxBytes) return content;
  const lines = content.split("\n"), keep = new Set();
  lines.forEach((l, i) => { if (terms.some((t) => l.toLowerCase().includes(t))) for (let k = Math.max(0, i - 40); k <= Math.min(lines.length - 1, i + 40); k++) keep.add(k); });
  const out = []; let prev = -2;
  for (const k of [...keep].sort((a, b) => a - b)) { if (k !== prev + 1) out.push(`/* ... [lines ${k + 1}+] ... */`); out.push(lines[k]); prev = k; }
  return out.join("\n").slice(0, maxBytes);
}

function termsOf(task, gate) {
  const base = String(task).toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((t) => t.length >= 3);
  const fromFailures = (gate?.failures ?? []).flatMap((f) => String(f).toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((t) => t.length >= 4));
  return [...new Set([...base, ...fromFailures])].slice(0, 30);
}

function pickFiles(guard, task, gate, extra = [], focus = false) {
  // Priority order: files the user pointed at, files named in failures, then repo-intelligence matches.
  const files = new Set(extra);
  for (const f of gate?.failures ?? []) { const p = String(f).split("::")[0]; if (/\.(ts|tsx|mjs|js)$/.test(p)) files.add(p); }
  if (!focus) {
    const q = guard.exec("node", ["scripts/wos-ai-agent-repo.mjs", "--query", task, "--limit", "12", "--json"], { timeoutMs: 60_000 });
    try { for (const m of JSON.parse(q.stdout).matches ?? []) files.add(m.file); } catch { /* optional */ }
  }
  return [...files].filter((f) => !/\.(backup|bak)|\.backup-/.test(f));
}

function context(guard, files, terms, perFile = 24_000, total = 60_000) {
  let used = 0; const parts = [];
  for (const f of files) {
    const c = guard.read(f); if (c == null) continue;
    const body = windows(c, terms, perFile);
    if (used + body.length > total) break;
    used += body.length;
    parts.push(`===== ${f} =====\n${scrub(body)}\n===== END ${f} =====`);
  }
  return parts.join("\n\n");
}

export function makeLlm({ guard, extraFiles = [], model, ask = askJsonOnce, focus = false, maxContextKb = 60, contract = false }) {
  const SYSTEM = contract && CONTRACT ? `${RULES}\n\n${CONTRACT}` : RULES;
  const maxCtx = Math.max(2, maxContextKb) * 1024;
  const ctx = (files, terms) => context(guard, files, terms, Math.min(24_000, maxCtx), maxCtx);
  const pick = (task, gate) => pickFiles(guard, task, gate, extraFiles, focus);
  return {
    async planner({ task, baseline, feedback = "", timeLeft }) {
      const files = pick(task, baseline);
      const user = [`Task: ${task}`, "", "Baseline gate failures:", scrub(baseline.failures.slice(0, 30).join("\n") || "(none: gate is green)"), "",
        "Write scope for edits: " + guard.writeScope.join(", "), "", ctx(files, termsOf(task, baseline)), "",
        "Return one JSON object with keys: rootCause (a sentence of at least 40 characters naming the real file and function), filesToInspect (array of real repo paths), proposedChanges (array of sentences), confidence (number 0..1)" +
          (contract ? `, layers (array chosen from ${LAYERS.join("/")}: the layer(s) that OWN the bug), multiLayerReason (only when more than one layer; explain why), evidence (array of objects {file, symbol}: a real repo file and an identifier or text that really appears in it and proves the root cause)` : "") +
          ". Fill them with REAL content from the files above; do not echo these key descriptions." + (feedback ? `\n\nYour previous plan was rejected: ${feedback}` : "")].join("\n");
      const plan = await askValidated({ system: SYSTEM, user, timeLeft, model, ask, validate: (j) => {
        const rc = [j.rootCause, j.root_cause, j.cause, j.diagnosis].find((v) => typeof v === "string" && v.trim()) ?? (Array.isArray(j.rootCause) ? j.rootCause.join(" ") : undefined);
        j.rootCause = rc;
        if (!isReal(rc, 40)) return "rootCause is missing, a placeholder, or shorter than 40 characters";
        if (contract) {
          if (!Array.isArray(j.layers) || !j.layers.length || j.layers.some((l) => !LAYERS.includes(l))) return `layers must be a non-empty array from: ${LAYERS.join(", ")}`;
          if (j.layers.length > 2) return "naming 3 or more layers is not a diagnosis: name the one or two layers that OWN the bug";
          if (j.layers.length > 1 && !isReal(j.multiLayerReason, 20)) return "several layers need a multiLayerReason";
          if (!Array.isArray(j.evidence) || !j.evidence.length || j.evidence.some((e) => !e || !isReal(e.file) || !isReal(e.symbol))) return "evidence must be an array of {file, symbol} with real values";
        }
        return "";
      } });
      plan._files = [...new Set([...(Array.isArray(plan.filesToInspect) ? plan.filesToInspect : []), ...files])];
      return plan;
    },
    async reproducer({ task, feedback = "", timeLeft }) {
      const example = guard.read("src/lib/ai/understanding/understanding.test.ts");
      const files = pick(task, { failures: [] });
      const user = [`Task (a bug report, no failing test exists yet): ${task}`, "",
        ...(example ? ["Example of how tests in this repo are written (vitest):", "```ts", example.split("\n").slice(0, 60).join("\n"), "```", ""] : []),
        ctx(files, termsOf(task, { failures: [] })), "",
        "Write ONE new vitest test file that asserts the CORRECT expected behaviour described in the task and that FAILS with the current code. Use only pure functions that already exist (no network, no database). Do not weaken or invent behaviour.",
        'Return one JSON object with keys: file (a NEW path under src/lib/ai/ ending in .agent-repro.test.ts), content (the whole TypeScript file), rationale (string). Use real content, not these descriptions.',
        feedback ? `\nYour previous test was rejected: ${feedback}` : ""].join("\n");
      return askValidated({ system: SYSTEM, user, timeLeft, model, ask, validate: (j) => {
        if (!isReal(j.file) || !/^src\/lib\/ai\/.+\.test\.ts$/.test(String(j.file).replace(/\\/g, "/"))) return "file must be a new path under src/lib/ai/ ending in .test.ts";
        if (!isReal(j.content, 60) || !/expect\(/.test(j.content) || !/\b(it|test)\(/.test(j.content)) return "content must be a real vitest file with it()/test() and expect()";
        return "";
      } });
    },
    async diagnoser({ task, plan, gate, history, timeLeft }) {
      const prior = history.filter((h) => h.gate).map((h) => `iteration ${h.n}: ${h.gate.summary}; files ${h.files.join(",")}; ${h.rationale ?? ""}`).join("\n");
      const evidence = gate.checks.filter((c) => c.status !== "PASS" && c.status !== "SKIPPED").map((c) => `## ${c.name} ${c.status}\n${c.summary}`).join("\n\n");
      const user = [`Task: ${task}`, `Plan root cause: ${plan?.rootCause}`, "", "Previous attempts:", prior || "(none)", "", "Current failing evidence:", scrub(evidence), "",
        "Diagnose WHY it fails now (do not propose code yet). Return one JSON object with keys: diagnosis (real explanation, 20+ characters), failingCause, nextApproach, avoid (array of approaches already tried that did not help). Use real content, not these descriptions."].join("\n");
      return askValidated({ system: SYSTEM, user, timeLeft, model, ask, validate: (j) => (isReal(j.diagnosis, 20) ? "" : "diagnosis is missing, a placeholder, or shorter than 20 characters") });
    },
    async patcher({ task, plan, diagnosis, gate, history, timeLeft }) {
      const files = [...new Set([...(plan?._files ?? []), ...pick(task, gate)])];
      const user = [`Task: ${task}`, `Root cause: ${plan?.rootCause}`, `Diagnosis: ${diagnosis.diagnosis}`, `Next approach: ${diagnosis.nextApproach ?? ""}`, `Avoid: ${JSON.stringify(diagnosis.avoid ?? [])}`, "",
        "Allowed write scope: " + guard.writeScope.join(", ") + " (existing test files are read-only; you may create NEW test files).",
        ...(contract ? [`Edit ONLY files in layer(s): ${(plan?.layers ?? []).join(", ")}. Do not quote a customer sentence from a test as a string literal in production code. At most 3 production files.`] : []), "",
        ...(history.filter((h) => h.note).length ? ["Your previous patches were REJECTED:", ...history.filter((h) => h.note).slice(-3).map((h) => `- ${h.note}`), "Copy 'old' text character-for-character from the file excerpts below; if the text you need is not shown, say so in rationale and edit only what is shown.", ""] : []),
        "Failing evidence:", scrub(gate.failures.slice(0, 30).join("\n")), "", ctx(files, termsOf(task, gate)), "",
        "Return one JSON object with keys: rationale (string) and edits (array). Each edit is an object with file (repo path), old (text copied EXACTLY from that file, appearing once), new (the replacement text). To create a brand-new file use {file, create: true, new: <whole file>} and omit old.",
        "'old' must match the file EXACTLY once. Keep edits minimal."].join("\n");
      return askValidated({ system: SYSTEM, user, timeLeft, model, ask, validate: (j) => {
        if (!Array.isArray(j.edits) || !j.edits.length) return "edits is missing or empty";
        for (const e of j.edits) {
          if (!e || !isReal(e.file) || typeof e.new !== "string" || PLACEHOLDER.test(e.new.trim())) return "an edit has a placeholder or missing file/new";
          if (e.create !== true && !isReal(e.old)) return `edit for ${e.file} has a placeholder or empty 'old'`;
        }
        return "";
      } });
    },
  };
}
