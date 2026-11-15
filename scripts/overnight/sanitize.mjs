export const WITHHELD = "[Diagnostic redacted: filtering failed]";

function isBasicCredential(token) {
  if (token === "[REDACTED]") return true;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(token) || token.length % 4 === 1) return false;
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    return decoded.includes(":");
  } catch {
    return false;
  }
}

function filter(text) {
  return text
    // Folded input needs indentation after the line break. Also accept JSON escapes.
    .replace(/(\bbasic(?:[ \t]|\\t|(?:\r?\n|(?:\\r)?\\n)(?=[ \t]|\\t))+)([A-Za-z0-9+/]+={0,2}|\[REDACTED\])/gi,
      (match, prefix, token) => isBasicCredential(token) ? `${prefix}[REDACTED]` : match)
    .replace(/(\bbearer[ \t]+)(?:\[REDACTED\]|[A-Za-z0-9+/_=.-]+)/gi, "$1[REDACTED]")
    .replace(/(\b[\w-]*(?:key|token|secret|password|passwd|credential)\b["']?\s*[:=]\s*)(["']?)(?:\[REDACTED\]|[^\s"',;}\]]+)/gi, "$1$2[REDACTED]")
    .replace(/(?<=:\/\/)[^/\s@]+:[^/\s@]+@/g, "[REDACTED]@")
    .replace(/\bsk-(?:\[REDACTED\]|[A-Za-z0-9_-]{12,})/g, "sk-[REDACTED]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[REDACTED_JWT]")
    .replace(/(-----BEGIN [^-]*PRIVATE KEY-----)[\s\S]*/g, "$1 [REDACTED]");
}

export function inspectText(value) {
  try {
    if (typeof value !== "string") return { text: WITHHELD, safe: false };
    const text = filter(value);
    return { text, safe: text === value && text !== WITHHELD };
  } catch {
    return { text: WITHHELD, safe: false };
  }
}

export function redact(value) {
  try { return inspectText(String(value ?? "")).text; }
  catch { return WITHHELD; }
}

export function redactError(error) {
  try { return redact(error?.message ?? error); }
  catch { return WITHHELD; }
}

export function sanitizeData(value) {
  const seen = new Set();
  function copy(input) {
    if (typeof input === "string") return redact(input);
    if (input == null || typeof input === "boolean" || typeof input === "number") return input;
    if (typeof input !== "object" || seen.has(input)) throw new Error(WITHHELD);
    seen.add(input);
    const output = Array.isArray(input) ? [] : {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, "value")) throw new Error(WITHHELD);
      if (inspectText(key).safe) Object.defineProperty(output, key, {
        value: copy(descriptor.value), enumerable: true, configurable: true, writable: true,
      });
    }
    seen.delete(input);
    return output;
  }
  return copy(value);
}

export function safeJson(value) {
  try {
    const text = JSON.stringify(sanitizeData(value), null, 2);
    if (typeof text === "string") return text;
  } catch { /* use the fixed payload below */ }
  return JSON.stringify({ error: WITHHELD });
}
