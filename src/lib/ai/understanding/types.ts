// Pure types + validation for the Understanding layer.
// No imports from the app (no supabase / next) so tests and eval run offline.

export const INTENTS = [
  'PROGRAM_DISCOVERY', // "อุดรมีอะไรบ้าง" - browse a province's programs
  'PROGRAM_SEARCH',    // "มีตรวจเข่าไหม" - look for a specific service
  'PROGRAM_MORE',      // "มีอีกไหม" - next page of the list just shown
  'PROGRAM_SELECTION', // "เอาอันแรก" - pick from the list just shown
  'PROGRAM_DETAIL',    // "ตัวนี้ราคาเท่าไหร่"
  'HOTEL',
  'TRANSPORT',
  'HANDOFF',
  'RESET',
  'GENERAL_QUESTION',
  'SMALLTALK',
  'UNKNOWN',
] as const;
export type Intent = (typeof INTENTS)[number];

export const DETAIL_FIELDS = ['price', 'booking', 'requirements', 'location', 'other'] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];

export type Lang = 'th' | 'lo' | 'en';

export interface Understanding {
  intent: Intent;
  confidence: number; // 0..1
  entities: {
    province: string | null;        // as the customer said it (NOT yet canonical)
    program_query: string | null;   // service wording, e.g. "ตรวจเข่า"
    selection_index: number | null; // 0-based; "อันแรก" = 0
    detail_field: DetailField | null;
  };
  uses_context: boolean; // sentence only makes sense given earlier turns
  language: 'th' | 'lo' | 'en' | 'mixed';
}

/** Minimal snapshot of a catalog row we showed the customer (mirrors ProgramSearchResult). */
export interface CatalogItem {
  id: string;
  title: string;
  description?: string | null;
  is_promotion?: boolean;
  original_price?: number | null;
  special_price?: number | null;
  duration?: string | null;
  duration_minutes?: number | null;
  partner?: { name?: string; province?: string | null };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const strOrNull = (v: unknown, max = 120): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || /^(null|undefined|none|n\/a)$/i.test(t)) return null;
  return t.slice(0, max);
};

/** Strict validation of the model's JSON. Returns null when it cannot be trusted. */
export function parseUnderstanding(raw: unknown): Understanding | null {
  if (!isRecord(raw)) return null;
  const intent = raw.intent;
  if (typeof intent !== 'string' || !(INTENTS as readonly string[]).includes(intent)) return null;
  const conf = raw.confidence;
  if (typeof conf !== 'number' || !Number.isFinite(conf)) return null;

  const e = isRecord(raw.entities) ? raw.entities : {};
  const idx = e.selection_index;
  const selection_index =
    typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx <= 19 ? idx : null;
  const df = e.detail_field;
  const detail_field =
    typeof df === 'string' && (DETAIL_FIELDS as readonly string[]).includes(df) ? (df as DetailField) : null;
  const lang = raw.language;

  return {
    intent: intent as Intent,
    confidence: Math.min(1, Math.max(0, conf)),
    entities: {
      province: strOrNull(e.province, 60),
      program_query: strOrNull(e.program_query, 80),
      selection_index,
      detail_field,
    },
    uses_context: raw.uses_context === true,
    language: lang === 'th' || lang === 'lo' || lang === 'en' || lang === 'mixed' ? lang : 'th',
  };
}

/** Pulls the first JSON object out of a model reply (tolerates ```json fences / prose). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
