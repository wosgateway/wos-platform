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
function usesLao(text: string, languageContext = ''): boolean {
  const current = text.trim();
  if (/[\u0E80-\u0EFF]/.test(current)) return true;
  if (/[\u0E00-\u0E7F]/.test(current) || /[A-Za-z]/.test(current)) return false;
  return /[\u0E80-\u0EFF]/.test(languageContext);
}

function usesThai(text: string, languageContext = ''): boolean {
  const current = text.trim();
  if (/[\u0E00-\u0E7F]/.test(current)) return true;
  if (/[\u0E80-\u0EFF]/.test(current) || /[A-Za-z]/.test(current)) return false;
  return /[\u0E00-\u0E7F]/.test(languageContext);
}

function baht(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function duration(p: VerifiedProgram, language: 'th' | 'lo' | 'en'): string | null {
  if (p.duration) return p.duration;
  if (typeof p.duration_minutes === 'number' && p.duration_minutes > 0) {
    return language === 'th'
      ? `${p.duration_minutes} นาที`
      : language === 'lo'
        ? `${p.duration_minutes} ນາທີ`
        : `${p.duration_minutes} minutes`;
  }
  return null;
}

function compactDescribe(p: VerifiedProgram, language: 'th' | 'lo' | 'en'): string {
  const title = p.title?.trim() ?? '';
  const price = typeof p.special_price === 'number' && p.special_price > 0
    ? p.special_price
    : typeof p.original_price === 'number' && p.original_price > 0
      ? p.original_price
      : null;
  if (price === null) return title;
  return language === 'en'
    ? `${title} — ${baht(price)} THB`
    : language === 'lo'
      ? `${title} — ${baht(price)} ບາດ`
      : `${title} — ${baht(price)} บาท`;
}

function describe(p: VerifiedProgram, language: 'th' | 'lo' | 'en'): string {
  const lines: string[] = [];
  const thai = language === 'th';
  const lao = language === 'lo';

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
          : lao
            ? `ລາຄາໂປຣໂມຊັນ ${baht(sp)} ບາດ (ລາຄາປົກກະຕິ ${baht(op)} ບາດ)`
            : `Promotional price: ${baht(sp)} THB (regular ${baht(op)} THB)`
      );
    } else {
      lines.push(thai ? `ราคา ${baht(sp)} บาท` : lao ? `ລາຄາ ${baht(sp)} ບາດ` : `Price: ${baht(sp)} THB`);
    }
  } else if (typeof op === 'number' && op > 0) {
    lines.push(thai ? `ราคา ${baht(op)} บาท` : lao ? `ລາຄາ ${baht(op)} ບາດ` : `Price: ${baht(op)} THB`);
  }

  const d = duration(p, language);
  if (d) lines.push(language === 'th' ? `ระยะเวลา ${d}` : language === 'lo' ? `ໄລຍະເວລາ ${d}` : `Duration: ${d}`);

  const desc = p.description?.trim();
  if (desc && desc !== p.title?.trim() && desc.length <= 300) {
    lines.push(desc);
  }

  return lines.join('\n   ');
}

export function buildProgramAnswer(
  programs: VerifiedProgram[],
  userMessage: string,
  languageContext = '',
  preferredLanguage?: 'th' | 'lo' | 'en'
): string | null {
  const list = programs
    .filter((p) => p.title && p.title.trim())
    .slice(0, MAX_PROGRAMS_IN_ANSWER);
  if (list.length === 0) return null;

  const lao = preferredLanguage ? preferredLanguage === 'lo' : usesLao(userMessage, languageContext);
  const thai = preferredLanguage ? preferredLanguage === 'th' : usesThai(userMessage, languageContext);
  const language: 'th' | 'lo' | 'en' = preferredLanguage ?? (lao ? 'lo' : thai ? 'th' : 'en');
  // Overview lists stay compact: title + price only. Details are shown when
  // the customer selects a specific program.
  const body = list
    .map((p, i) => `${i + 1}. ${list.length > 1 ? compactDescribe(p, language) : describe(p, language)}`)
    .join('\n\n');

  if (lao) {
    const style = [...userMessage].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % 4;
    const intro = list.length === 1
      ? [
          'ຖ້າກຳລັງຫາບໍລິການຕາມນີ້ ຕອນນີ້ມີ 1 ລາຍການຄ່ະ',
          'ມີລາຍການນີ້ຢູ່ຄ່ະ ໃບເຟີນລວບລວມຂໍ້ມູນສຳຄັນໃຫ້ແລ້ວ',
          'ເຈີລາຍການທີ່ກົງກັບທີ່ຖາມແລ້ວຄ່ະ',
          'ສຳລັບທີ່ຖາມມາ ຕອນນີ້ມີລາຍການນີ້ຄ່ະ',
        ][style]
      : [
          'ມີຕົວເລືອກຕາມນີ້ຄ່ະ',
          'ໃບເຟີນລວບລວມຕົວເລືອກທີ່ພົບໃຫ້ກ່ອນຄ່ະ',
          'ຕອນນີ້ມີຫຼາຍລາຍການທີ່ກົງກັບທີ່ຖາມຄ່ະ',
          'ຖ້າກຳລັງຫາບໍລິການປະເພດນີ້ ມີຕົວເລືອກຕາມນີ້ຄ່ະ',
        ][style];
    const nextStep = list.length === 1
      ? 'ຖ້າສົນໃຈ ໃບເຟີນຊ່ວຍເບິ່ງລາຍລະອຽດ ແລະຂັ້ນຕອນຈອງຕໍ່ໃຫ້ໄດ້ຄ່ະ'
      : 'ສົນໃຈໂປຣແກຣມໃດ ບອກໝາຍເລກໃຫ້ໃບເຟີນໄດ້ເລີຍ ແລ້ວຈະຊ່ວຍເບິ່ງລາຍລະອຽດຕໍ່ໃຫ້';
    return intro + '\n\n' + body + '\n\n' + nextStep;
  }

  if (thai) {
    const style = [...userMessage].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % 4;
    const intro = list.length === 1
      ? [
          'มีรายการที่ตรงกับที่ถามอยู่ 1 โปรแกรมค่ะ',
          'ถ้ากำลังมองหาบริการแบบนี้ ตอนนี้มีรายการนี้ค่ะ',
          'เจอรายการที่ตรงกับที่ถามแล้วค่ะ',
          'สำหรับที่ถามมา ตอนนี้มีตัวเลือกนี้ค่ะ',
        ][style]
      : [
          'มีตัวเลือกที่ตรงกับที่ถามประมาณนี้ค่ะ',
          'ถ้ากำลังมองหาบริการแบบนี้ ใบเฟิร์นรวบรวมตัวเลือกที่มีตอนนี้ให้ดูค่ะ',
          'ตอนนี้มีหลายรายการที่ตรงกับที่ถามค่ะ',
          'ใบเฟิร์นสรุปตัวเลือกที่เจอให้ก่อนนะคะ',
        ][style];
    const nextStep =
      list.length === 1
        ? 'ถ้าสนใจรายการนี้ บอกใบเฟิร์นได้เลยนะคะ เดี๋ยวช่วยดูรายละเอียดหรือพาไปต่อขั้นตอนจองให้ค่ะ'
        : 'ถ้าสนใจตัวไหน บอกหมายเลขหรือชื่อโปรแกรมได้เลยค่ะ ใบเฟิร์นจะช่วยดูรายละเอียดของตัวนั้นต่อให้';
    return `${intro}\n\n${body}\n\n${nextStep}`;
  }

  const intro =
    list.length === 1
      ? 'Sure — I checked the verified WOS data, and there is one program that matches your question.'
      : `Sure — I checked the verified WOS data, and found ${list.length} programs that match your question.`;
  const nextStep =
    list.length === 1
      ? 'If you like, I can walk you through the details of this program.'
      : 'สนใจรายการไหน บอกเลขหรือชื่อโปรแกรมได้เลยนะคะ ใบเฟิร์นจะขยายรายละเอียดให้ค่ะ';
  return `${intro}\n\n${body}\n\n${nextStep}`;
}

/** Concise answer for a price follow-up on the currently selected program. */
export function buildProgramPriceAnswer(
  program: VerifiedProgram | undefined,
  userMessage: string,
  languageContext = '',
  preferredLanguage?: 'th' | 'lo' | 'en'
): string | null {
  if (!program?.title) return null;

  const lao = preferredLanguage ? preferredLanguage === 'lo' : usesLao(userMessage, languageContext);
  const thai = preferredLanguage ? preferredLanguage === 'th' : usesThai(userMessage, languageContext);
  const language: 'th' | 'lo' | 'en' = preferredLanguage ?? (lao ? 'lo' : thai ? 'th' : 'en');
  const special = typeof program.special_price === 'number' && program.special_price > 0
    ? program.special_price
    : null;
  const original = typeof program.original_price === 'number' && program.original_price > 0
    ? program.original_price
    : null;

  if (special === null && original === null) {
    return language === 'lo'
      ? 'ຕອນນີ້ຍັງບໍ່ມີລາຄາທີ່ຢືນຢັນໄດ້ສຳລັບ "' + program.title + '" ຄ່ະ'
      : language === 'th'
        ? 'ตอนนี้ยังไม่มีราคาที่ใบเฟิร์นยืนยันได้สำหรับ "' + program.title + '" ค่ะ'
        : 'I do not have a verified price for "' + program.title + '" yet.';
  }

  if (program.is_promotion && special !== null && original !== null && original > special) {
    return language === 'lo'
      ? 'ໂປຣແກຣມ "' + program.title + '" ຕອນນີ້ລາຄາໂປຣໂມຊັນ ' + baht(special) + ' ບາດ ຈາກລາຄາປົກກະຕິ ' + baht(original) + ' ບາດຄ່ະ'
      : language === 'th'
        ? 'โปรแกรม "' + program.title + '" ตอนนี้ราคาโปรโมชั่น ' + baht(special) + ' บาท จากราคาปกติ ' + baht(original) + ' บาทค่ะ'
        : 'For "' + program.title + '", the current promotional price is ' + baht(special) + ' THB, down from the regular ' + baht(original) + ' THB.';
  }

  const price = special ?? original!;
  return language === 'lo'
    ? 'ໂປຣແກຣມ "' + program.title + '" ລາຄາ ' + baht(price) + ' ບາດຄ່ະ'
    : language === 'th'
      ? 'โปรแกรม "' + program.title + '" ราคา ' + baht(price) + ' บาทค่ะ'
      : '"' + program.title + '" is ' + baht(price) + ' THB.';
}

/**
 * Safe escalation fallback. When verified WOS data is insufficient, Fern must
 * stop rather than guess or repeat a stale refusal. This wording deliberately
 * says the information needs WOS-team verification; it does not claim that a
 * human has already received a ticket because AI Core has no escalation-write
 * tool yet.
 */
export function buildFallbackReply(userMessage: string): string {
  if (usesLao(userMessage)) {
    return 'ຂໍໂທດຄ່ະ ເລື່ອງນີ້ໃບເຟີນຍັງບໍ່ມີຂໍ້ມູນທີ່ຢືນຢັນໄດ້ ແລະບໍ່ຢາກເດົາໃຫ້ຂໍ້ມູນຜິດ. ໃບເຟີນຂໍໃຫ້ທີມ WOS ກວດສອບແລະດຳເນີນການຕໍ່ໃຫ້ຄ່ະ';
  }
  return usesThai(userMessage)
    ? 'เรื่องนี้ใบเฟิร์นยังไม่มีข้อมูลที่ยืนยันได้ค่ะ ไม่อยากเดาให้ข้อมูลผิด เดี๋ยวขอให้ทีม WOS ตรวจสอบและดำเนินการต่อให้ค่ะ'
    : 'I do not have verified information for this yet, and I do not want to guess. I’ll have the WOS team verify it and continue from there.';
}
