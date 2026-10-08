// Integration point called from runWosAI().
//   WOS_AI_UNDERSTANDING=off     (default) -> no-op, zero behaviour change
//   WOS_AI_UNDERSTANDING=shadow  -> understand + decide + log, but legacy still answers
//   WOS_AI_UNDERSTANDING=on      -> handles the program-catalog intents; everything else defers
// Any error, timeout or low confidence => { handled:false } and the legacy path runs as before.
import { buildProgramAnswer, buildProgramPriceAnswer, type VerifiedProgram } from '../program-answer';
import { getCatalogProvinces, getProgramDetails, searchPrograms } from '../programs';
import { detectWosLanguage, type WosLanguage } from '../language-dictionary';
import { createUnderstandLlm } from './llm';
import { catalogMatchesHistory, decide, type Action, type DecideContext } from './orchestrator';
import { coveredProvinceIds, type ProvinceRecord } from './provinces';
import { clearState, loadProvinces, loadState, logAiRequest, saveState } from './state';
import type { CatalogItem } from './types';
import { understand } from './understand';

export type GateResult = { handled: true; text: string } | { handled: false };
type History = { role: 'user' | 'assistant'; content: string }[];

const NOT_HANDLED: GateResult = { handled: false };
const MAX_MESSAGE_LEN = 400;

function mode(): 'off' | 'shadow' | 'on' {
  const v = (process.env.WOS_AI_UNDERSTANDING ?? 'off').trim().toLowerCase();
  return v === 'on' || v === 'shadow' ? v : 'off';
}

const tr = (l: WosLanguage, s: { th: string; lo: string; en: string }) => s[l];

const names = (ids: string[], provinces: ProvinceRecord[], l: WosLanguage) =>
  ids
    .map((id) => provinces.find((p) => p.id === id))
    .filter((p): p is ProvinceRecord => !!p)
    .map((p) => (l === 'lo' && p.name_lo) || (l === 'en' && p.name_en) || p.name_th)
    .join(', ');

function toItem(p: Awaited<ReturnType<typeof searchPrograms>>[number]): CatalogItem {
  return {
    id: p.id, title: p.title, description: p.description, is_promotion: p.is_promotion,
    original_price: p.original_price, special_price: p.special_price,
    duration: p.duration, duration_minutes: p.duration_minutes, partner: p.partner,
  };
}

async function execute(
  action: Action,
  a: { message: string; lang: WosLanguage; provinces: ProvinceRecord[]; conversationId?: string; channel: string },
): Promise<string | null> {
  const { lang, provinces, conversationId, channel } = a;
  const save = (p: Parameters<typeof saveState>[2]) => (conversationId ? saveState(conversationId, channel, p) : Promise.resolve());

  switch (action.type) {
    case 'ASK_PROVINCE': {
      const list = names(action.coveredIds, provinces, lang);
      return tr(lang, {
        th: 'สนใจโปรแกรมของจังหวัดไหนคะ 😊' + (list ? ` ตอนนี้ WOS มีข้อมูลของ ${list} ค่ะ` : ''),
        lo: 'ສົນໃຈໂປຣແກຣມຂອງແຂວງ/ຈັງຫວັດໃດຄະ 😊' + (list ? ` ຕອນນີ້ WOS ມີຂໍ້ມູນຂອງ ${list} ຄ່ະ` : ''),
        en: 'Which province are you interested in? 😊' + (list ? ` WOS currently has programs in ${list}.` : ''),
      });
    }
    case 'NO_COVERAGE': {
      const list = names(action.coveredIds, provinces, lang);
      const p = (lang === 'lo' && action.province.name_lo) || (lang === 'en' && action.province.name_en) || action.province.name_th;
      return tr(lang, {
        th: `ตอนนี้ใบเฟิร์นยังไม่มีโปรแกรมที่ยืนยันแล้วของ${p}ค่ะ` + (list ? ` ที่มีตอนนี้คือ ${list}` : '') + ' ให้ทีม WOS ช่วยตรวจสอบเพิ่มเติมให้ไหมคะ',
        lo: `ຕອນນີ້ໃບເຟີນຍັງບໍ່ມີໂປຣແກຣມທີ່ຢືນຢັນແລ້ວຂອງ ${p} ຄ່ະ` + (list ? ` ທີ່ມີຕອນນີ້ແມ່ນ ${list}` : '') + ' ໃຫ້ທີມ WOS ຊ່ວຍກວດສອບເພີ່ມບໍຄະ',
        en: `I don't have verified programs for ${p} yet.` + (list ? ` Currently available: ${list}.` : '') + ' Would you like the WOS team to check for you?',
      });
    }
    case 'ASK_SELECTION':
      return tr(lang, {
        th: 'ลูกค้าหมายถึงโปรแกรมไหนคะ บอกหมายเลขหรือชื่อโปรแกรมที่อยู่ในรายการได้เลยค่ะ',
        lo: 'ໝາຍເຖິງໂປຣແກຣມໃດຄະ ບອກໝາຍເລກ ຫຼື ຊື່ໂປຣແກຣມໃນລາຍການໄດ້ເລີຍຄ່ະ',
        en: 'Which program do you mean? Please tell me the number or name from the list.',
      });
    case 'ASK_CLARIFY':
      return action.item
        ? tr(lang, {
            th: `หมายถึง "${action.item.title}" ใช่ไหมคะ`,
            lo: `ໝາຍເຖິງ "${action.item.title}" ແມ່ນບໍຄະ`,
            en: `Do you mean "${action.item.title}"?`,
          })
        : null;

    case 'SEARCH': {
      const query = [action.query, action.province?.name_th].filter(Boolean).join(' ');
      const wanted = action.kind === 'more' ? Math.min(action.offset + 5, 10) : 5;
      const found = await searchPrograms(query, wanted);
      const items = action.kind === 'more' ? found.slice(action.offset) : found;
      if (items.length === 0) {
        return action.kind === 'more'
          ? tr(lang, {
              th: 'ตอนนี้ไม่มีโปรแกรมเพิ่มเติมจากที่แสดงไปแล้วค่ะ สนใจตัวไหนในรายการ บอกหมายเลขได้เลยนะคะ',
              lo: 'ຕອນນີ້ບໍ່ມີໂປຣແກຣມເພີ່ມເຕີມຈາກທີ່ສະແດງແລ້ວຄ່ະ',
              en: 'There are no more programs beyond the ones already shown.',
            })
          : tr(lang, {
              th: 'ตอนนี้ใบเฟิร์นยังไม่พบรายการที่ตรงกับที่ถามในข้อมูลที่ยืนยันแล้วค่ะ ให้ทีม WOS ช่วยตรวจสอบต่อให้ไหมคะ',
              lo: 'ຕອນນີ້ໃບເຟີນຍັງບໍ່ພົບລາຍການທີ່ກົງກັບທີ່ຖາມໃນຂໍ້ມູນທີ່ຢືນຢັນແລ້ວຄ່ະ ໃຫ້ທີມ WOS ຊ່ວຍກວດສອບຕໍ່ບໍຄະ',
              en: 'I could not find a matching verified program yet. Would you like the WOS team to check?',
            });
      }
      const text = buildProgramAnswer(items.map(toItem) as VerifiedProgram[], a.message, '', lang);
      if (!text) return null;
      await save({
        provinceId: action.province?.id ?? null,
        lastCatalog: items.map(toItem),
        catalogQuery: { provinceId: action.province?.id ?? null, query: action.query },
        catalogOffset: action.kind === 'more' ? action.offset + items.length : items.length,
        selectedProgramId: null,
      });
      return text;
    }

    case 'SELECT':
    case 'DETAIL': {
      // Live truth: re-read the row (price/status can change) instead of trusting the stored snapshot.
      const fresh = await getProgramDetails(action.item.id);
      if (!fresh) return null; // no longer published/active -> let legacy path respond
      const live = { ...fresh, id: action.item.id } as VerifiedProgram;
      const text =
        action.type === 'DETAIL' && action.field === 'price'
          ? buildProgramPriceAnswer(live, a.message, '', lang)
          : buildProgramAnswer([live], a.message, '', lang);
      if (text) await save({ selectedProgramId: action.item.id });
      return text;
    }
    default:
      return null;
  }
}

export async function runUnderstandingGate(args: {
  userMessage: string;
  history: History;
  conversationId?: string;
  channel?: string;
}): Promise<GateResult> {
  const m = mode();
  if (m === 'off') return NOT_HANDLED;
  const message = args.userMessage.trim();
  if (!message || message.length > MAX_MESSAGE_LEN) return NOT_HANDLED;

  const channel = args.channel ?? (args.conversationId ? 'chatwoot' : 'web');
  const t0 = Date.now();
  const log = (extra: Partial<Parameters<typeof logAiRequest>[0]>) =>
    logAiRequest({ conversationId: args.conversationId, channel, mode: m, message, handled: false, latencyMs: Date.now() - t0, ...extra });

  try {
    const [provinces, catalogNames, state] = await Promise.all([
      loadProvinces(),
      getCatalogProvinces(),
      args.conversationId ? loadState(args.conversationId) : Promise.resolve(null),
    ]);
    if (provinces.length === 0) { await log({ deferReason: 'no_provinces' }); return NOT_HANDLED; }

    const trusted = state && catalogMatchesHistory(state.lastCatalog, args.history);
    const ctx: DecideContext = {
      recentCatalog: trusted ? state!.lastCatalog : [],
      catalogOffset: trusted ? state!.catalogOffset : 0,
      catalogQuery: trusted ? state!.catalogQuery : null,
      selectedProgramId: trusted ? state!.selectedProgramId : null,
      journeyProvinceId: state?.provinceId ?? null,
    };

    const { understanding: u, error } = await understand(createUnderstandLlm(), message, args.history, ctx.recentCatalog);
    if (!u) { await log({ error, deferReason: 'understand_failed' }); return NOT_HANDLED; }

    const action = decide(u, message, ctx, { provinces, coveredProvinceIds: coveredProvinceIds(catalogNames, provinces) });
    const base = { language: u.language, intent: u.intent, confidence: u.confidence, entities: u.entities, action: action.type };

    if (action.type === 'RESET' && args.conversationId && m === 'on') await clearState(args.conversationId);
    if (m === 'shadow' || action.type === 'DEFER' || action.type === 'RESET') {
      await log({ ...base, deferReason: action.type === 'DEFER' ? action.reason : null });
      return NOT_HANDLED;
    }

    const lang = detectWosLanguage(message, args.history.filter((h) => h.role === 'user').map((h) => h.content));
    const text = await execute(action, { message, lang, provinces, conversationId: args.conversationId, channel });
    await log({ ...base, handled: !!text, deferReason: text ? null : 'execute_returned_null' });
    return text ? { handled: true, text } : NOT_HANDLED;
  } catch (err) {
    await log({ error: err instanceof Error ? err.message.slice(0, 200) : 'gate_error', deferReason: 'exception' });
    return NOT_HANDLED;
  }
}
