// Claude Code CLI adapter for the WOS overnight supervisor (Phase 1: adapter only).
// Plugs into makeLlm({ ask }) in llm.mjs: ask(messages, timeLeft, model) -> { text, json }.
//
// Claude Code is used as a TEXT-ONLY proposer: every tool is disabled (--tools ""), the prompt travels over
// stdin, and the model's JSON is applied by guard.applyEdits exactly like the LiteLLM path. Claude never
// touches the working tree, git, .env files or the network on its own.
//
// Runtime dependencies: node + a Claude Code executable. No Desktop Commander, no Claude Desktop chat.
// This file never sends a request by itself; callers decide when to call askClaudeOnce / makeClaudeAsk.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { scrub } from "./guard.mjs";

export class ClaudeExecError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ClaudeExecError";
    this.code = code;
  }
}

const REPLACEMENT_CHAR = /\uFFFD/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,99}$/;
const SYSTEM_PROMPT =
  "You are a JSON-only responder inside an automated code-repair pipeline. No tools are available and none are needed. " +
  "Reply with exactly one JSON object and no other text and no markdown fences.";

// Only these variables reach the Claude process. Secrets of the WOS app (LITELLM_*, OPENAI_*, SUPABASE_*,
// TELEGRAM_*, NOTION_*, WOS_*, ...) are NOT forwarded. Claude's own auth (ANTHROPIC_*, CLAUDE_*) is.
const ENV_ALLOW = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "APPDATA",
  "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "TEMP", "TMP", "TMPDIR", "USERNAME",
  "USERDOMAIN", "COMPUTERNAME", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "LANG", "LC_ALL", "TERM", "SHELL",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
]);
const ENV_ALLOW_PREFIX = ["ANTHROPIC_", "CLAUDE_"];

export function buildChildEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string") continue;
    const u = k.toUpperCase();
    if (ENV_ALLOW.has(u) || ENV_ALLOW_PREFIX.some((p) => u.startsWith(p))) out[k] = v;
  }
  out.NO_COLOR = "1";
  return out;
}

const brief = (s, n = 400) => scrub(String(s ?? "")).replace(/\s+/g, " ").trim().slice(0, n);
const pathFor = (platform) => (platform === "win32" ? path.win32 : path.posix);

// ---------------------------------------------------------------- semver / discovery

export function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v ?? "").trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? "" } : null;
}

/** Numeric comparison (2.1.9 < 2.1.10); a pre-release sorts below its release. */
export function compareSemver(a, b) {
  const x = typeof a === "string" ? parseSemver(a) : a;
  const y = typeof b === "string" ? parseSemver(b) : b;
  if (!x || !y) throw new TypeError("compareSemver: not a semantic version");
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

const exeName = (platform) => (platform === "win32" ? "claude.exe" : "claude");
const envGet = (env, name) => {
  const k = Object.keys(env).find((key) => key.toUpperCase() === name);
  return k ? env[k] : undefined;
};

/** %APPDATA%\Claude\claude-code\<version>\claude.exe, highest numeric version first. Never hard-codes a version. */
export function listBundledClaude({ env = process.env, platform = process.platform, fsImpl = { existsSync, readdirSync } } = {}) {
  const appData = envGet(env, "APPDATA");
  if (!appData) return [];
  const P = pathFor(platform);
  const root = P.join(appData, "Claude", "claude-code");
  let names = [];
  try { names = fsImpl.readdirSync(root).map(String); } catch { return []; }
  return names
    .map((name) => ({ version: name, semver: parseSemver(name) }))
    .filter((e) => e.semver)
    .map((e) => ({ ...e, path: P.join(root, e.version, exeName(platform)) }))
    .filter((e) => { try { return Boolean(fsImpl.existsSync(e.path)); } catch { return false; } })
    .sort((a, b) => compareSemver(b.semver, a.semver));
}

// ---------------------------------------------------------------- Windows npm shim (parsed as DATA, never executed)

// The official npm shim for Claude Code (claude.cmd) only sets dp0 and launches the native claude.exe shipped
// inside the package. We never run the .cmd: we read it as text, prove it is exactly that, and spawn the native exe.
// Anything else (extra commands, chaining, %COMSPEC%, other targets, missing %*) is rejected: fail closed.
const SHIM_SETUP_LINES = [
  /^@ECHO off$/i, /^GOTO start$/i, /^:find_dp0$/i, /^:start$/i,
  /^SET dp0=%~dp0$/i, /^EXIT \/b$/i, /^SETLOCAL$/i, /^CALL :find_dp0$/i,
];
const SHIM_LAUNCH = /^"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude\.exe"\s+%\*$/i;
const SHIM_MAX_BYTES = 4096;
const SHIM_TARGET_PARTS = ["node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"];

function shimTextIsOfficial(text) {
  if (typeof text !== "string" || text.length === 0 || text.includes("\0")) return false;
  if (Buffer.byteLength(text, "utf8") > SHIM_MAX_BYTES) return false;
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).map((l) => l.trim()).filter(Boolean);
  let launches = 0, sawDp0 = false, sawLabel = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SHIM_LAUNCH.test(line)) { launches++; if (i !== lines.length - 1) return false; continue; }
    if (!SHIM_SETUP_LINES.some((re) => re.test(line))) return false;
    if (/^SET dp0=/i.test(line)) sawDp0 = true;
    if (/^:find_dp0$/i.test(line)) sawLabel = true;
  }
  return launches === 1 && sawDp0 && sawLabel;
}

/**
 * claude.cmd (official npm shim) -> { path, command, prefixArgs: [], via: "npm-shim", shim } or null.
 * Windows path semantics are explicit (path.win32) so the result does not depend on the host platform.
 * The target is built from constants, never from text in the file; its realpath must stay inside the shim's own
 * node_modules\@anthropic-ai\claude-code package, so junctions/symlinks that escape are rejected.
 */
export function resolveNpmShim(cmdPath, { fsImpl = { readFileSync, existsSync, realpathSync, statSync } } = {}) {
  const W = path.win32;
  try {
    if (typeof cmdPath !== "string" || cmdPath.includes("\0") || /^\\\\/.test(cmdPath)) return null;
    if (!W.isAbsolute(cmdPath) || !/\.cmd$/i.test(cmdPath)) return null;
    if (typeof fsImpl.statSync === "function" && fsImpl.statSync(cmdPath).size > SHIM_MAX_BYTES) return null;
    if (!shimTextIsOfficial(fsImpl.readFileSync(cmdPath, "utf8"))) return null;
    const dir = W.dirname(cmdPath);
    const pkgDir = W.join(dir, ...SHIM_TARGET_PARTS.slice(0, 3));
    const target = W.join(dir, ...SHIM_TARGET_PARTS);
    if (!fsImpl.existsSync(target)) return null;
    const realDir = fsImpl.realpathSync(dir);
    const realPkg = fsImpl.realpathSync(pkgDir);
    const realTarget = fsImpl.realpathSync(target);
    const inside = (child, parent) => String(child).toLowerCase().startsWith(String(parent).replace(/[\\/]+$/, "").toLowerCase() + "\\");
    if (!inside(realPkg, W.join(realDir, "node_modules"))) return null;
    if (!inside(realTarget, realPkg)) return null;
    if (W.basename(realTarget).toLowerCase() !== "claude.exe") return null;
    return { path: realTarget, command: realTarget, prefixArgs: [], via: "npm-shim", shim: cmdPath };
  } catch { return null; }
}

/**
 * Every usable `claude` on PATH, in PATH order. Per directory: claude.exe first, then claude.cmd (npm shim, resolved to
 * its native exe). A malformed shim is skipped. .ps1 and extensionless shims are never considered.
 */
export function listClaudeOnPath({ env = process.env, platform = process.platform, fsImpl = { existsSync, readFileSync, realpathSync, statSync } } = {}) {
  const P = pathFor(platform);
  const out = [], seen = new Set();
  const add = (d) => { const k = platform === "win32" ? d.command.toLowerCase() : d.command; if (!seen.has(k)) { seen.add(k); out.push(d); } };
  for (const part of (envGet(env, "PATH") ?? "").split(platform === "win32" ? ";" : ":")) {
    const dir = part.trim().replace(/^"|"$/g, "");
    if (!dir) continue;
    const exe = P.join(dir, exeName(platform));
    let hasExe = false;
    try { hasExe = Boolean(fsImpl.existsSync(exe)); } catch { /* keep looking */ }
    if (hasExe) { add({ path: exe, command: exe, prefixArgs: [], via: "exe" }); continue; }
    if (platform !== "win32") continue;
    const cmd = P.join(dir, "claude.cmd");
    try { if (fsImpl.existsSync(cmd)) { const d = resolveNpmShim(cmd, { fsImpl }); if (d) add(d); } } catch { /* skip candidate */ }
  }
  return out;
}

/** First usable `claude` on PATH as a native executable path (kept for compatibility), or null. */
export function findClaudeOnPath(options = {}) {
  return listClaudeOnPath(options)[0]?.command ?? null;
}

/** `2.1.302 (Claude Code)`: semantic version AND the Claude Code identity on the first output line. */
export const CLAUDE_VERSION_RE = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?\s+\(Claude Code\)$/;

/**
 * Runs `<command> [...prefixArgs] --version` (no shell, no login, no model call).
 * `exe` is a path string or a descriptor { command, prefixArgs }. Returns { version, raw } or throws CLAUDE_VERSION_INVALID.
 */
export function validateClaudeExecutable(exe, { env = process.env, spawnSyncImpl = spawnSync, timeoutMs = 15_000 } = {}) {
  const command = typeof exe === "string" ? exe : exe?.command;
  const prefixArgs = typeof exe === "string" ? [] : (exe?.prefixArgs ?? []);
  if (typeof command !== "string" || !command) throw new ClaudeExecError("CLAUDE_VERSION_INVALID", "no executable to validate");
  const r = spawnSyncImpl(command, [...prefixArgs, "--version"], { encoding: "utf8", timeout: timeoutMs, windowsHide: true, shell: false, env: buildChildEnv(env), stdio: ["ignore", "pipe", "pipe"] });
  if (r?.error) {
    const why = r.error.code === "ETIMEDOUT" ? `timed out after ${timeoutMs}ms` : brief(r.error.message, 120);
    throw new ClaudeExecError("CLAUDE_VERSION_INVALID", `'${command} --version' failed: ${why}`);
  }
  if (r?.status !== 0) throw new ClaudeExecError("CLAUDE_VERSION_INVALID", `'${command} --version' exited with ${r?.status}: ${brief(r?.stderr, 120)}`);
  const raw = String(r.stdout ?? "").replace(/^\uFEFF/, "").trim();
  const m = CLAUDE_VERSION_RE.exec(raw.split(/\r?\n/)[0].trim());
  if (!m) throw new ClaudeExecError("CLAUDE_VERSION_INVALID", `'${command} --version' did not identify as "<semver> (Claude Code)": ${brief(raw, 120)}`);
  return { version: m[1], raw: raw.slice(0, 120) };
}

/**
 * Order: WOS_CLAUDE_EXE -> claude on PATH (.exe, then npm claude.cmd shim) -> highest bundled %APPDATA%\Claude\claude-code\<ver>\claude.exe.
 * An explicit WOS_CLAUDE_EXE never falls back silently. Returns a descriptor
 * { path, command, prefixArgs, via, source, version, rawVersion } where command is always a native executable.
 */
export function discoverClaudeExecutable(options = {}) {
  const { env = process.env, platform = process.platform, fsImpl = { existsSync, readdirSync, readFileSync, realpathSync, statSync }, spawnSyncImpl = spawnSync, validateTimeoutMs = 15_000 } = options;
  const exists = (p) => { try { return Boolean(fsImpl.existsSync(p)); } catch { return false; } };
  const rejected = [];
  const attempt = (d, source) => {
    try {
      const v = validateClaudeExecutable(d, { env, spawnSyncImpl, timeoutMs: validateTimeoutMs });
      return { ...d, path: d.command, source, version: v.version, rawVersion: v.raw };
    } catch (e) { rejected.push(`${source} ${d.command}: ${brief(e.message, 160)}`); return null; }
  };

  const override = String(envGet(env, "WOS_CLAUDE_EXE") ?? "").trim().replace(/^["']|["']$/g, "");
  if (override) {
    if (!exists(override)) throw new ClaudeExecError("CLAUDE_NOT_FOUND", `WOS_CLAUDE_EXE points to a file that does not exist: ${override}`);
    let desc = { path: override, command: override, prefixArgs: [], via: "exe" };
    if (platform === "win32") {
      const ext = path.win32.extname(override).toLowerCase();
      if (ext === ".cmd") {
        desc = resolveNpmShim(override, { fsImpl });
        if (!desc) throw new ClaudeExecError("CLAUDE_UNSUPPORTED_SHIM", `WOS_CLAUDE_EXE is a .cmd that is not the official npm Claude Code shim (it is never executed): ${override}`);
      } else if (ext !== ".exe") {
        throw new ClaudeExecError("CLAUDE_UNSUPPORTED_SHIM", `WOS_CLAUDE_EXE must be a native .exe or an official npm claude.cmd shim: ${override}`);
      }
    }
    const hit = attempt(desc, "env");
    if (hit) return hit;
    throw new ClaudeExecError("CLAUDE_VERSION_INVALID", `WOS_CLAUDE_EXE failed validation (${rejected.join("; ")})`);
  }

  for (const d of listClaudeOnPath({ env, platform, fsImpl })) { const hit = attempt(d, "path"); if (hit) return hit; }

  for (const b of listBundledClaude({ env, platform, fsImpl })) {
    const hit = attempt({ path: b.path, command: b.path, prefixArgs: [], via: "bundled" }, "bundled");
    if (hit) return hit;
  }

  if (rejected.length) throw new ClaudeExecError("CLAUDE_VERSION_INVALID", `found Claude executable(s) but none passed --version: ${rejected.join("; ")}`);
  throw new ClaudeExecError("CLAUDE_NOT_FOUND", "no Claude Code executable found (checked WOS_CLAUDE_EXE, PATH (claude.exe / npm claude.cmd) and %APPDATA%\\Claude\\claude-code\\<version>\\claude.exe). Set WOS_CLAUDE_EXE.");
}

// ---------------------------------------------------------------- request

/** Fixed, reviewed flag set. No permission bypass is possible through this function. */
export function buildClaudeArgs({ model, maxBudgetUsd } = {}) {
  const args = ["--print", "--input-format", "text", "--output-format", "json", "--tools", "", "--safe-mode", "--no-session-persistence", "--system-prompt", SYSTEM_PROMPT];
  if (model != null && model !== "") {
    if (typeof model !== "string" || !MODEL_RE.test(model)) throw new ClaudeExecError("CLAUDE_BAD_ARGS", "model name has an unexpected shape");
    args.push("--model", model);
  }
  if (maxBudgetUsd != null) {
    const n = Number(maxBudgetUsd);
    if (!Number.isFinite(n) || n <= 0) throw new ClaudeExecError("CLAUDE_BAD_ARGS", "maxBudgetUsd must be a positive number");
    args.push("--max-budget-usd", String(n));
  }
  if (args.some((a) => /dangerously|bypassPermissions|--permission-mode/i.test(a))) throw new ClaudeExecError("CLAUDE_BAD_ARGS", "permission bypass flags are not allowed");
  return args;
}

function assertCleanText(value, label) {
  const s = String(value);
  if (REPLACEMENT_CHAR.test(s)) throw new ClaudeExecError("CLAUDE_ENCODING", `${label} contains U+FFFD (corrupted text); refusing to continue`);
  if (typeof s.isWellFormed === "function" && !s.isWellFormed()) throw new ClaudeExecError("CLAUDE_ENCODING", `${label} contains a lone surrogate`);
}

function assertCleanJson(value, label) {
  if (typeof value === "string") assertCleanText(value, label);
  else if (Array.isArray(value)) value.forEach((v) => assertCleanJson(v, label));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { assertCleanText(k, label); assertCleanJson(v, label); }
}

/** messages: [{role, content}] as produced by llm.mjs askValidated. Everything goes to stdin as one UTF-8 text. */
export function buildPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw new ClaudeExecError("CLAUDE_BAD_ARGS", "messages must be a non-empty array");
  const titles = { system: "SYSTEM INSTRUCTIONS", user: "USER", assistant: "YOUR PREVIOUS REPLY" };
  const parts = messages.map((m, i) => {
    if (!m || typeof m.content !== "string" || !titles[m.role]) throw new ClaudeExecError("CLAUDE_BAD_ARGS", `message ${i} has an unsupported role or non-string content`);
    const content = i === 0 ? m.content.replace(/^\uFEFF/, "") : m.content;
    assertCleanText(content, `message ${i}`);
    return `### ${titles[m.role]}\n${content}`;
  });
  return `${parts.join("\n\n")}\n\n### REQUIRED OUTPUT\nReply with exactly one JSON object and nothing else.\n`;
}

// ---------------------------------------------------------------- process

function runProcess({ spawnImpl, exe, args, input, env, timeoutMs, maxOutputBytes }) {
  return new Promise((resolve, reject) => {
    let child, timer, settled = false, outBytes = 0;
    const out = [], err = [];
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const killAll = () => {
      try { child?.kill(); } catch { /* already gone */ }
      if (process.platform === "win32" && child?.pid) {
        try { spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, timeout: 5000, stdio: "ignore" }); } catch { /* best effort */ }
      }
    };
    try { child = spawnImpl(exe, args, { env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (e) { return reject(new ClaudeExecError("CLAUDE_SPAWN", brief(e.message))); }
    timer = setTimeout(() => { killAll(); finish(reject, new ClaudeExecError("CLAUDE_TIMEOUT", `Claude call exceeded ${timeoutMs}ms and was killed`)); }, timeoutMs);
    child.on("error", (e) => finish(reject, new ClaudeExecError("CLAUDE_SPAWN", brief(e.message))));
    child.stdout.on("data", (c) => {
      outBytes += c.length;
      if (outBytes > maxOutputBytes) { killAll(); finish(reject, new ClaudeExecError("CLAUDE_OUTPUT_TOO_LARGE", `stdout exceeded ${maxOutputBytes} bytes`)); return; }
      out.push(c);
    });
    child.stderr.on("data", (c) => { if (err.reduce((n, b) => n + b.length, 0) < 64 * 1024) err.push(c); });
    child.on("close", (code, signal) => finish(resolve, { code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }));
    child.stdin.on("error", () => { /* child exited before reading everything: the exit code reports it */ });
    child.stdin.end(input);
  });
}

function decodeUtf8Strict(buf, label) {
  let s;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { throw new ClaudeExecError("CLAUDE_ENCODING", `${label} is not valid UTF-8`); }
  s = s.replace(/^\uFEFF/, "");
  assertCleanText(s, label);
  return s;
}

function resultTextOf(envelope) {
  const env = Array.isArray(envelope) ? [...envelope].reverse().find((e) => e && e.type === "result") : envelope;
  if (!env || typeof env !== "object") throw new ClaudeExecError("CLAUDE_BAD_JSON", "unexpected Claude CLI output (no result object)");
  if (env.is_error === true || (typeof env.subtype === "string" && env.subtype.startsWith("error"))) {
    throw new ClaudeExecError("CLAUDE_ERROR_RESULT", `Claude reported an error (${brief(env.subtype ?? "error", 60)}): ${brief(env.result, 200)}`);
  }
  if (typeof env.result !== "string") throw new ClaudeExecError("CLAUDE_BAD_SCHEMA", "Claude CLI result has no string 'result' field");
  return { text: env.result, meta: { durationMs: Number.isFinite(env.duration_ms) ? env.duration_ms : undefined, costUsd: Number.isFinite(env.total_cost_usd) ? env.total_cost_usd : undefined } };
}

function parseModelJson(text) {
  let json;
  try { json = JSON.parse(text.trim()); }
  catch {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!m) throw new ClaudeExecError("CLAUDE_BAD_JSON", `model reply is not valid JSON: ${brief(text, 160)}`);
    try { json = JSON.parse(m[1]); } catch { throw new ClaudeExecError("CLAUDE_BAD_JSON", `fenced model reply is not valid JSON: ${brief(m[1], 160)}`); }
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new ClaudeExecError("CLAUDE_BAD_SCHEMA", "model reply must be one JSON object");
  return json;
}

/**
 * ask(messages, timeLeft, model, options) -> { text, json, meta }   (same contract as askJsonOnce in llm.mjs)
 * options: { executable, prefixArgs, maxBudgetUsd, timeoutMs, maxOutputBytes, env, spawnImpl, discover, discoverOptions }
 * `executable` + `prefixArgs` exist so tests can substitute a fake process; production code lets discovery pick the binary.
 * A discovered descriptor contributes its own prefixArgs (empty for a native claude.exe). Batch/script files are never run.
 */
export async function askClaudeOnce(messages, timeLeft, model, options = {}) {
  const { env = process.env, spawnImpl = spawn, executable, prefixArgs = [], maxBudgetUsd, timeoutMs = 600_000, maxOutputBytes = 8 * 1024 * 1024, discover = discoverClaudeExecutable, discoverOptions = {} } = options;
  const prompt = buildPrompt(messages);
  const claudeArgs = buildClaudeArgs({ model, maxBudgetUsd });
  const budget = Math.min(Number(timeLeft), timeoutMs);
  if (!Number.isFinite(budget) || budget < 1000) throw new ClaudeExecError("CLAUDE_TIMEOUT", "no time left for a Claude call");
  let exe = executable, pre = [...prefixArgs];
  if (!exe) { const d = discover({ env, ...discoverOptions }); exe = d.command ?? d.path; pre = [...(d.prefixArgs ?? []), ...prefixArgs]; }
  if (typeof exe !== "string" || /\.(cmd|bat|ps1)$/i.test(exe)) throw new ClaudeExecError("CLAUDE_BAD_ARGS", "refusing to run a script/batch file: a native executable is required");
  const args = [...pre, ...claudeArgs];

  const started = Date.now();
  const r = await runProcess({ spawnImpl, exe, args, input: Buffer.from(prompt, "utf8"), env: buildChildEnv(env), timeoutMs: budget, maxOutputBytes });
  if (r.code !== 0) {
    const stderr = brief(new TextDecoder("utf-8").decode(r.stderr), 300);
    throw new ClaudeExecError("CLAUDE_EXIT", `Claude exited with ${r.code ?? r.signal}${stderr ? `: ${stderr}` : ""}`);
  }
  const stdout = decodeUtf8Strict(r.stdout, "stdout");
  if (!stdout.trim()) throw new ClaudeExecError("CLAUDE_EMPTY", "Claude produced no output");
  let envelope;
  try { envelope = JSON.parse(stdout); } catch { throw new ClaudeExecError("CLAUDE_BAD_JSON", `Claude CLI output is not JSON: ${brief(stdout, 160)}`); }
  const { text, meta } = resultTextOf(envelope);
  if (!text.trim()) throw new ClaudeExecError("CLAUDE_EMPTY", "Claude returned an empty result");
  assertCleanText(text, "result");
  const json = parseModelJson(text);
  assertCleanJson(json, "result JSON");
  return { text, json, meta: { ...meta, wallMs: Date.now() - started } };
}

/** Adapter for makeLlm({ ask }): discovers the executable once (lazily) and reuses it. */
export function makeClaudeAsk(options = {}) {
  let found = options.executable ? { command: options.executable, prefixArgs: [] } : null;
  return async (messages, timeLeft, model) => {
    if (!found) found = (options.discover ?? discoverClaudeExecutable)({ env: options.env ?? process.env, ...(options.discoverOptions ?? {}) });
    return askClaudeOnce(messages, timeLeft, model ?? options.model, { ...options, executable: found.command ?? found.path, prefixArgs: [...(found.prefixArgs ?? []), ...(options.prefixArgs ?? [])] });
  };
}
