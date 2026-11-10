// =====================================================================
// Leak guard for "tool call written as plain text".
//
// Some models (Typhoon / Ollama behind LiteLLM) occasionally answer with
// something like {"type":"function","function":"searchPrograms",...} in
// message.content instead of a native tool_calls entry. If that text is
// sent to the customer it is stored in Chatwoot as an outgoing message,
// then fetched back as `assistant` history on the next turn, and the model
// imitates its own earlier mistake (feedback loop).
//
// Two defences live here, both used by AI Core (core.ts):
//   1. looksLikeLeakedToolCall() - check a model answer BEFORE it is sent
//   2. sanitizeHistory()         - drop such answers from history that was
//                                  already sent before this guard existed
// =====================================================================

// Keep in sync with the tool names declared in core.ts.
const TOOL_NAMES = ['searchPrograms', 'getProgramDetails', 'answerDirectly'];
const TOOL_NAME_REGEX = new RegExp(`\\b(?:${TOOL_NAMES.join('|')})\\b`);

// Chat-template / provider-specific markers that wrap a tool call when the
// backend fails to parse it into tool_calls.
const TOOL_CALL_MARKERS: RegExp[] = [
  /<\s*\/?\s*(?:tool_call|tool_code|function_call)\s*>/i,
  /<\|?\s*python_tag\s*\|?>/i,
  /\[\s*TOOL_CALLS?\s*\]/i,
  /<\|?\s*(?:tool|function)_call(?:s)?\s*\|?>/i,
];

// JSON keys that only show up in a serialized tool call, never in a
// customer-facing answer.
const TOOL_CALL_JSON_KEYS =
  /"(?:tool_calls|function_call|arguments)"\s*:|"type"\s*:\s*"function"/;

function stripCodeFence(text: string): string {
  const match = text.match(/^```[a-zA-Z_]*\s*([\s\S]*?)\s*```$/);
  return match ? match[1].trim() : text;
}

/**
 * True when `text` looks like a serialized tool call (or any raw JSON
 * document) rather than natural language meant for a customer.
 */
export function looksLikeLeakedToolCall(text: string | null | undefined): boolean {
  if (!text) return false;

  const trimmed = text.trim();
  if (!trimmed) return false;

  // Internal tool names must never appear in a customer-facing message.
  if (TOOL_NAME_REGEX.test(trimmed)) return true;

  if (TOOL_CALL_MARKERS.some((re) => re.test(trimmed))) return true;
  if (TOOL_CALL_JSON_KEYS.test(trimmed)) return true;

  // The whole message is a JSON object/array (optionally in a code fence).
  const body = stripCodeFence(trimmed);
  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed !== null && typeof parsed === 'object') return true;
    } catch {
      // Truncated / malformed JSON: only flag it when it clearly looks like
      // a call, so replies that merely start with "[" are left alone.
      if (/"(?:name|function|tool|arguments|parameters)"\s*:/.test(body)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Remove assistant turns that are leaked tool calls from conversation
 * history, so the model never sees them as "things I said before".
 * User turns are never touched.
 */
export function sanitizeHistory<T extends { role: string; content: string }>(
  history: T[]
): T[] {
  return history.filter(
    (m) => !(m.role === 'assistant' && looksLikeLeakedToolCall(m.content))
  );
}
