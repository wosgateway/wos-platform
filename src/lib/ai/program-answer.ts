// =====================================================================
// Deterministic customer answer built ONLY from verified tool results.
//
// Used as the last resort when the model keeps answering with raw JSON
// after a successful searchPrograms / getProgramDetails call (leak-guard
// rejected it). Every value comes straight from the database result; nothing
// is guessed, and availability for a date is never claimed.
// =====================================================================

export type VerifiedProgram = {
  title?: string;
  description?: string | null;
  is_promotion?: boolean;
  original_price?: number | null;
  special_price?: number | null;
  duration?: string | null;
  duration_minutes?: number | null;
  partner?: { name?: string; province?: string | null };
};

const MAX_PROGRAMS_IN_ANSWER = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pull programs out of a tool result payload (search items or one detail item). */
export function extractVerifiedPrograms(
  toolName: string,
  result: unknown
): VerifiedProgram[] {
  if (!isRecord(result) || result.success !== true) return [];

  if (toolName === 'searchPrograms' && Array.isArray(result.items)) {
    return result.items.filter(isRecord) as VerifiedProgram[];
  }
  if (toolName === 'getProgramDetails' && isRecord(result.item)) {
    return [result.item as VerifiedProgram];
  }
  return [];
}

// Thai and Lao script -> Thai reply (program data is stored in Thai).
// Everything else -> English.
function usesThai(text: string): boolean {
  return /[\u0E00-\u0EFF]/.test(text);
}

function baht(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function duration(p: VerifiedProgram, thai: boolean): string | null {
  if (p.duration) return p.duration;
  if (typeof p.duration_minutes === 'number' && p.duration_minutes > 0) {
    return thai
      ? `${p.duration_minutes} นาที`
      : `${p.duration_minutes} minutes`;
  }
  return null;
}

function describe(p: VerifiedProgram, thai: boolean): string {
  const lines: string[] = [];

  const partnerBits = [p.partner?.name, p.partner?.province].filter(Boolean);
  lines.push(
    partnerBits.length > 0
      ? `${p.title ?? ''} — ${partnerBits.join(' / ')}`
      : `${p.title ?? ''}`
  );

  const sp = p.special_price;
  const op = p.original_price;
  if (typeof sp === 'number' && sp > 0) {
    if (p.is_promotion && typeof op === 'number' && op > sp) {
      lines.push(
        thai
          ? `ราคาโปรโมชั่น ${baht(sp)} บาท (ราคาปกติ ${baht(op)} บาท)`
          : `Promotional price: ${baht(sp)} THB (regular ${baht(op)} THB)`
      );
    } else {
      lines.push(thai ? `ราคา ${baht(sp)} บาท` : `Price: ${baht(sp)} THB`);
    }
  } else if (typeof op === 'number' && op > 0) {
    lines.push(thai ? `ราคา ${baht(op)} บาท` : `Price: ${baht(op)} THB`);
  }

  const d = duration(p, thai);
  if (d) lines.push(thai ? `ระยะเวลา ${d}` : `Duration: ${d}`);

  const desc = p.description?.trim();
  if (desc && desc !== p.title?.trim() && desc.length <= 300) {
    lines.push(desc);
  }

  return lines.join('\n   ');
}

export function buildProgramAnswer(
  programs: VerifiedProgram[],
  userMessage: string
): string | null {
  const list = programs
    .filter((p) => p.title && p.title.trim())
    .slice(0, MAX_PROGRAMS_IN_ANSWER);
  if (list.length === 0) return null;

  const thai = usesThai(userMessage);
  const body = list.map((p, i) => `${i + 1}. ${describe(p, thai)}`).join('\n\n');

  return thai
    ? `พบโปรแกรมที่ตรงกับคำถามของคุณ ${list.length} รายการค่ะ\n\n${body}\n\nหากสนใจหรืออยากสอบถามเพิ่มเติม แจ้งทีมงาน WOS ได้เลยค่ะ`
    : `We found ${list.length} matching WOS program${list.length > 1 ? 's' : ''}:\n\n${body}\n\nIf you are interested or have questions, please let the WOS team know.`;
}

/** Generic apology in the customer's language (Thai/Lao script -> Thai). */
export function buildFallbackReply(userMessage: string): string {
  return usesThai(userMessage)
    ? 'ขออภัยค่ะ ตอนนี้ยังไม่สามารถตอบคำถามนี้ได้ กรุณาติดต่อทีมงาน WOS ค่ะ'
    : 'Sorry, I could not complete that request right now. Please contact the WOS team for help.';
}
