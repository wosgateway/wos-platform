// =====================================================================
// Server-side guards for model tool calls.
//
// Observed failures from Typhoon/LiteLLM tool calling:
//   1. The tool name comes back as "function" and the real tool name is
//      inside the arguments, e.g. name="function",
//      arguments={"function":"searchPrograms","query":"...","limit":5}
//      -> "Unknown WOS AI tool: function".
//   2. After an empty search the model invents a program id
//      ("ProgramID", "program_id", "12345") and calls getProgramDetails,
//      which reaches Postgres and fails with 22P02 (invalid uuid).
//
// These helpers repair (1), block (2) before any database call, and give the
// model a deterministic instruction when a search returns nothing, so the
// safety rule does not depend on the model remembering the prompt.
// =====================================================================

// Keep in sync with the tools declared in core.ts.
// Pseudo-tool the model calls when no program lookup is needed; core.ts drops
// it and re-asks without tools (see the tools array in core.ts).
export const NO_LOOKUP_TOOL = 'answerDirectly';

export const KNOWN_TOOL_NAMES = [
  'searchPrograms',
  'getProgramDetails',
  NO_LOOKUP_TOOL,
] as const;

const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_EXACT = new RegExp(`^${UUID_PATTERN}$`, 'i');

// Keys a model may use to carry the real tool name / payload.
const NAME_KEYS = ['function', 'name', 'tool', 'tool_name'] as const;
const PAYLOAD_KEYS = ['arguments', 'parameters', 'args'] as const;
const WRAPPER_KEYS = new Set<string>(['type', ...NAME_KEYS, ...PAYLOAD_KEYS]);

export const NO_RESULT_MESSAGE =
  'No matching program was found for this keyword. Do not call getProgramDetails and do not invent a program ID or program details. You may retry searchPrograms once with a different, broader Thai keyword; otherwise tell the customer politely that no matching program was found.';

// A search that finds nothing may be retried once (with a different keyword).
// After MAX_EMPTY_SEARCHES empty results in one run the server stops running
// further searches, so the loop cannot burn every tool round on the same
// empty query.
export const MAX_EMPTY_SEARCHES = 2;

export type SearchState = { emptyCount: number };

export const SEARCH_LIMIT_MESSAGE =
  'No matching program was found after retrying. Do not call searchPrograms again and do not call getProgramDetails. Tell the customer politely that no matching published WOS program was found, and offer to have the WOS team help.';

export const INVALID_PROGRAM_ID_MESSAGE =
  'Invalid or unknown programId. Only use an id returned by searchPrograms in this conversation. Call searchPrograms first; never invent a program ID.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type KnownToolName = (typeof KNOWN_TOOL_NAMES)[number];

function isKnownToolName(value: unknown): value is KnownToolName {
  return (
    typeof value === 'string' &&
    (KNOWN_TOOL_NAMES as readonly string[]).includes(value)
  );
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_EXACT.test(value);
}

/** All UUIDs (lower-cased) that appear in a piece of text. */
export function extractUuids(text: string): string[] {
  const matches = text.match(new RegExp(UUID_PATTERN, 'gi'));
  return matches ? matches.map((m) => m.toLowerCase()) : [];
}

/** UUIDs already present in the conversation context (system, history, user). */
export function collectUuidsFromMessages(
  messages: ReadonlyArray<{ content?: unknown }>
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (typeof message.content === 'string') {
      for (const id of extractUuids(message.content)) ids.add(id);
    }
  }
  return ids;
}

export type NormalizedToolCall = {
  name: string;
  args: Record<string, unknown>;
  /** true when the model's raw call had to be repaired */
  repaired: boolean;
};

function coerceRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Turn whatever the model sent into { name, args } for a known tool.
 * Well-formed calls pass through untouched. Unrepairable calls are returned
 * as-is so executeTool reports "Unknown WOS AI tool" as before.
 */
export function normalizeToolCall(
  rawName: string,
  rawArgs: unknown
): NormalizedToolCall {
  const args = isRecord(rawArgs) ? rawArgs : {};

  if (isKnownToolName(rawName)) {
    return { name: rawName, args, repaired: false };
  }

  // "functions.searchPrograms", "functions/searchPrograms", ...
  const shortName = rawName.split(/[.:/]/).pop() ?? rawName;
  let name: string | undefined = isKnownToolName(shortName)
    ? shortName
    : undefined;

  // name="function" and the real name inside the arguments.
  if (!name) {
    for (const key of NAME_KEYS) {
      if (isKnownToolName(args[key])) {
        name = args[key] as string;
        break;
      }
    }
  }

  if (!name) {
    return { name: rawName, args, repaired: false };
  }

  // Payload is either nested ("arguments": {...}) or flat next to the name.
  for (const key of PAYLOAD_KEYS) {
    const nested = coerceRecord(args[key]);
    if (nested) return { name, args: nested, repaired: true };
  }

  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!WRAPPER_KEYS.has(key)) flat[key] = value;
  }
  return { name, args: flat, repaired: true };
}

/**
 * Returns a tool-result payload when the call must NOT be executed, or null
 * when it is fine to run.
 */
export function validateToolArgs(
  name: string,
  args: Record<string, unknown>,
  knownProgramIds: ReadonlySet<string>,
  searchState: SearchState
): Record<string, unknown> | null {
  if (name === 'searchPrograms' && searchState.emptyCount >= MAX_EMPTY_SEARCHES) {
    return { success: true, count: 0, items: [], message: SEARCH_LIMIT_MESSAGE };
  }

  if (name === 'getProgramDetails') {
    const programId = args.programId;
    if (!isUuid(programId) || !knownProgramIds.has(programId.toLowerCase())) {
      return { success: false, message: INVALID_PROGRAM_ID_MESSAGE };
    }
  }
  return null;
}

/**
 * Post-process a tool result: remember program ids that searchPrograms
 * returned, and add a deterministic instruction when it returned nothing.
 */
export function annotateToolResult(
  name: string,
  result: unknown,
  knownProgramIds: Set<string>,
  searchState: SearchState
): unknown {
  if (name !== 'searchPrograms' || !isRecord(result)) return result;

  const items = Array.isArray(result.items) ? result.items : [];
  for (const item of items) {
    if (isRecord(item) && typeof item.id === 'string' && item.id) {
      knownProgramIds.add(item.id.toLowerCase());
    }
  }

  if (result.success === true && items.length === 0) {
    searchState.emptyCount += 1;
    return { ...result, message: NO_RESULT_MESSAGE };
  }
  return result;
}
