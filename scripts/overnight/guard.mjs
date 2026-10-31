// Permission Guard for the WOS Overnight Agent.
// Everything the agent runs or writes goes through this module. Default = DENY.
// The agent can: read the repo, run typecheck / unit tests / regression / read-only git,
// and edit files inside the configured DEV scope. It can never stage, commit, push, deploy,
// touch secrets, production files, migrations, or its own guard/tests-harness.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_WRITE_SCOPE = ["src/lib/ai/**"];
const WRITE_EXT = /\.(?:ts|tsx|js|mjs|cjs|json|md)$/i;
const MAX_FILE_BYTES = 400 * 1024;

// Paths the agent may never write, regardless of scope.
const PROTECTED_PATH = [
  /^\.git(\/|$)/, /(^|\/)node_modules(\/|$)/, /(^|\/)\.env(\.|$)/, /(^|\/)\.vercel(\/|$)/,
  /(^|\/)production/i, /prod(uction)?[-_]?config/i, /^vercel\.json$/i,
  /^supabase(\/|$)/, /^sql(\/|$)/, /(^|\/)migrations(\/|$)/,
  /^package(-lock)?\.json$/, /^(pnpm-lock\.yaml|yarn\.lock)$/, /^next\.config\./, /^dockerfile$/i, /^\.dockerignore$/i,
  /^scripts\/(wos-ai-agent|production|overnight|telegram|preflight|resolve-ai)/i,
  /^\.overnight(\/|$)/, /^src\/middleware\./,
  /\.(backup|bak)([-.]|$)/i, /\.backup-/i,
  /(secret|credential|private[-_]?key)/i,
];
const TEST_FILE = /(\.test\.|\.spec\.|(^|\/)ai-regression-test\.mjs$)/i;
export const SECRET_IN_TEXT = /(SERVICE_ROLE_KEY|ACCESS_TOKEN|API_KEY|TELEGRAM_BOT_TOKEN|NOTION_TOKEN|SECRET)\s*[=:]\s*['"]?[A-Za-z0-9_\-./+]{12,}|sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}/;

const DENY_BIN = new Set([
  "vercel", "curl", "wget", "rm", "rmdir", "del", "mv", "cp", "sh", "bash", "zsh", "cmd", "cmd.exe", "powershell", "powershell.exe",
  "pwsh", "ssh", "scp", "docker", "supabase", "psql", "gh", "sudo", "pip", "pnpm", "yarn",
]);
const GIT_READONLY = new Set(["status", "diff", "ls-files", "rev-parse", "log", "show"]);
const GIT_DENIED = new Set([
  "add", "commit", "push", "reset", "checkout", "restore", "stash", "clean", "rm", "mv", "merge", "rebase",
  "tag", "fetch", "pull", "config", "cherry-pick", "revert", "apply", "am", "switch", "worktree", "remote",
]);

export function globToRegex(glob) {
  const g = glob.replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") { re += ".*"; i++; if (g[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if ("\\^$+?.()|{}[]".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export function scrub(text) {
  return String(text ?? "")
    .replace(/((?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*\s*[=:]\s*)(['"]?)[^\s'"]{4,}/gi, "$1$2[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{20,}/g, "sk-[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+)?/g, "[REDACTED_JWT]");
}

export function parseDuration(value, fallbackMs) {
  if (value == null || value === "") return fallbackMs;
  const s = String(value).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60_000); // bare number = minutes
  let total = 0, matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)/g)) {
    matched = true;
    total += Number(m[1]) * { h: 3_600_000, m: 60_000, s: 1000 }[m[2]];
  }
  if (!matched || s.replace(/(\d+(?:\.\d+)?)\s*(h|m|s)/g, "").trim()) throw new Error(`Invalid duration: ${value}`);
  return Math.round(total);
}

export function createGuard({
  root = process.cwd(),
  writeScope = DEFAULT_WRITE_SCOPE,
  allowTestEdits = false,
  regressionFile = "ai-regression-test.mjs",
  npmScripts = [],
  maxFiles = 12,
} = {}) {
  const ROOT = realpathSync(root);
  const scope = writeScope.map(globToRegex);
  const violations = [];
  const touched = new Set();
  const nodeScripts = new Set([regressionFile, "scripts/wos-ai-agent-repo.mjs", "scripts/telegram-notify.mjs", "scripts/resolve-ai-test-url.mjs"].map((p) => p.replace(/\\/g, "/")));

  const deny = (kind, detail, reason) => {
    violations.push({ kind, detail: scrub(detail), reason });
    return { allowed: false, reason };
  };

  function checkCommand(cmd, args = []) {
    const bin = path.basename(String(cmd)).toLowerCase().replace(/\.(cmd|exe)$/, "");
    const line = [cmd, ...args].join(" ");
    if (DENY_BIN.has(bin) || DENY_BIN.has(String(cmd).toLowerCase())) return deny("command", line, `binary '${bin}' is not allowed`);
    if (bin === "git") {
      const sub = args.find((a) => !a.startsWith("-"));
      if (!sub) return deny("command", line, "git requires a subcommand");
      if (GIT_DENIED.has(sub)) return deny("git", line, `git ${sub} is forbidden for the overnight agent`);
      if (sub === "branch") {
        if (args.length === 2 && args[1] === "--show-current") return { allowed: true };
        return deny("git", line, "only 'git branch --show-current' is allowed");
      }
      if (!GIT_READONLY.has(sub)) return deny("git", line, `git ${sub} is not on the read-only allowlist`);
      if (args.some((a) => /^--output|^--ext-diff|^-o$/.test(a))) return deny("git", line, "git output redirection is not allowed");
      return { allowed: true };
    }
    if (bin === "npx") {
      const tool = args[0];
      if (tool === "tsc" && args.includes("--noEmit")) return { allowed: true };
      if (tool === "vitest" && args[1] === "run" && !args.some((a) => /^(-u|--update)/.test(a))) return { allowed: true };
      return deny("command", line, "npx is limited to 'tsc --noEmit' and 'vitest run' (no snapshot updates)");
    }
    if (bin === "npm") {
      if (args[0] === "run" && npmScripts.includes(args[1])) return { allowed: true };
      return deny("command", line, "npm is limited to explicitly allowlisted 'npm run <script>'");
    }
    if (bin === "node") {
      const script = path.posix.normalize(String(args[0] ?? "").replace(/\\/g, "/").replace(/^\.\//, ""));
      if (nodeScripts.has(script)) return { allowed: true };
      return deny("command", line, `node script '${script}' is not allowlisted`);
    }
    return deny("command", line, `'${bin}' is not on the command allowlist`);
  }

  function normalizeRel(rel) {
    return path.posix.normalize(String(rel).replace(/\\/g, "/").replace(/^\.\//, ""));
  }

  function checkWrite(rel, { creating = false } = {}) {
    const n = normalizeRel(rel);
    if (!n || n.startsWith("../") || path.isAbsolute(n) || /^[a-z]:/i.test(n)) return deny("write", rel, "path escapes repository");
    const abs = path.resolve(ROOT, n);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return deny("write", rel, "path escapes repository");
    if (existsSync(abs)) {
      if (lstatSync(abs).isSymbolicLink()) return deny("write", rel, "symlinks are not editable");
      const real = realpathSync(abs);
      if (!real.startsWith(ROOT + path.sep)) return deny("write", rel, "resolved path escapes repository");
    }
    if (PROTECTED_PATH.some((re) => re.test(n))) return deny("write", rel, "protected path (secrets/production/migrations/agent harness)");
    if (!WRITE_EXT.test(n)) return deny("write", rel, "file type not allowlisted");
    if (!scope.some((re) => re.test(n))) return deny("write", rel, `outside DEV write scope (${writeScope.join(", ")})`);
    if (TEST_FILE.test(n) && !creating && !allowTestEdits) return deny("write", rel, "existing tests are read-only (pass --allow-test-edits to change them)");
    if (!touched.has(n) && touched.size >= maxFiles) return deny("write", rel, `max ${maxFiles} files per run`);
    return { allowed: true, rel: n, abs };
  }

  function exec(cmd, args = [], { timeoutMs = 600_000, input } = {}) {
    const verdict = checkCommand(cmd, args);
    if (!verdict.allowed) return { ok: false, denied: true, status: null, stdout: "", stderr: verdict.reason, output: `DENIED: ${verdict.reason}`, timedOut: false };
    const bin = path.basename(cmd).toLowerCase();
    let exe = cmd, exeArgs = args;
    if (process.platform === "win32" && (bin === "npx" || bin === "npm")) {
      exe = "cmd.exe"; exeArgs = ["/d", "/s", "/c", `${bin}.cmd ${args.join(" ")}`];
    }
    const r = spawnSync(exe, exeArgs, { cwd: ROOT, encoding: "utf8", timeout: Math.max(1000, timeoutMs), maxBuffer: 64 * 1024 * 1024, input, windowsHide: true });
    const timedOut = r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
    const stdout = r.stdout ?? "", stderr = r.stderr ?? "";
    return { ok: r.status === 0 && !timedOut, denied: false, status: r.status, stdout, stderr, output: scrub(`${stdout}\n${stderr}`.trim()), timedOut, error: r.error?.message };
  }

  function read(rel) {
    const n = normalizeRel(rel);
    if (n.startsWith("../") || path.isAbsolute(n) || PROTECTED_PATH.slice(0, 5).some((re) => re.test(n)) || /(^|\/)\.env/.test(n)) return null;
    const abs = path.resolve(ROOT, n);
    if (!existsSync(abs) || lstatSync(abs).isSymbolicLink()) return null;
    if (!abs.startsWith(ROOT + path.sep)) return null;
    const content = readFileSync(abs, "utf8");
    return content.length > MAX_FILE_BYTES * 4 ? null : content;
  }

  // Apply a batch of {file, old, new} edits atomically (all validate, or nothing is written).
  // {file, create:true, new} creates a brand-new file.
  function applyEdits(edits) {
    if (!Array.isArray(edits) || edits.length === 0) throw new Error("patch contains no edits");
    const staged = new Map(); // rel -> { before, after, creating, abs }
    for (const e of edits) {
      if (!e || typeof e.file !== "string" || typeof e.new !== "string") throw new Error("malformed edit");
      const creating = e.create === true;
      const v = checkWrite(e.file, { creating: creating && !existsSync(path.resolve(ROOT, normalizeRel(e.file))) });
      if (!v.allowed) throw new Error(`guard: ${v.reason} (${e.file})`);
      if (SECRET_IN_TEXT.test(e.new)) { deny("write", e.file, "secret-looking content in new text"); throw new Error(`guard: secret-looking content in edit for ${e.file}`); }
      let cur = staged.get(v.rel);
      if (!cur) {
        const exists = existsSync(v.abs);
        if (creating && exists) throw new Error(`create:true but file exists: ${v.rel}`);
        if (!creating && !exists) throw new Error(`target does not exist: ${v.rel}`);
        const before = exists ? readFileSync(v.abs, "utf8") : null;
        cur = { before, after: before ?? "", creating: !exists, abs: v.abs };
        staged.set(v.rel, cur);
      }
      if (creating) { cur.after = e.new; continue; }
      if (typeof e.old !== "string" || e.old.length === 0) throw new Error(`edit for ${v.rel} needs a non-empty 'old'`);
      const n = cur.after.split(e.old).length - 1;
      if (n !== 1) throw new Error(`edit for ${v.rel}: expected exactly 1 match for 'old', found ${n}`);
      cur.after = cur.after.replace(e.old, () => e.new);
    }
    for (const [rel, s] of staged) {
      if (Buffer.byteLength(s.after) > MAX_FILE_BYTES) throw new Error(`file too large after edit: ${rel}`);
    }
    for (const [rel, s] of staged) {
      mkdirSync(path.dirname(s.abs), { recursive: true });
      writeFileSync(s.abs, s.after, "utf8");
      touched.add(rel);
    }
    return [...staged].map(([rel, s]) => ({ file: rel, created: s.creating, before: s.before, after: s.after }));
  }

  // Used by the supervisor to roll back to a snapshot (agent-created files are removed, not git-rm'd).
  function restore(snapshot) {
    for (const [rel, content] of Object.entries(snapshot)) {
      const v = checkWrite(rel, { creating: true });
      if (!v.allowed) throw new Error(`guard: cannot restore ${rel}: ${v.reason}`);
      if (content === null) { if (existsSync(v.abs)) unlinkSync(v.abs); }
      else writeFileSync(v.abs, content, "utf8");
    }
  }

  function snapshotTouched() {
    const snap = {};
    for (const rel of touched) {
      const abs = path.resolve(ROOT, rel);
      snap[rel] = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    }
    return snap;
  }

  return { root: ROOT, checkCommand, checkWrite, exec, read, applyEdits, restore, snapshotTouched, violations, touched, writeScope };
}
