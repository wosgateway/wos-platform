import OpenAI from 'openai';
import { WOS_AI_SYSTEM_PROMPT } from './prompts';
import { looksLikeLeakedToolCall, sanitizeHistory } from './leak-guard';
import {
  buildFallbackReply,
  buildProgramAnswer,
  buildProgramPriceAnswer,
  extractVerifiedPrograms,
  type VerifiedProgram,
} from './program-answer';
import {
  annotateToolResult,
  collectUuidsFromMessages,
  looksCorruptedOrMistranslated,
  NO_LOOKUP_TOOL,
  normalizeToolCall,
  validateToolArgs,
} from './tool-guard';
import {
  searchPrograms,
  searchHealthProgramOverview,
  getProgramDetails,
  getCatalogProvinces,
  detectLocationFromRawText,
} from './programs';
import { searchWosNotionKnowledge } from './notion-knowledge';
import { searchHotelAvailability } from './hotel-availability';
import { createServiceClient } from '@/lib/supabase/service';
import {
  detectWosLanguage,
  getLanguageDictionaryHints,
  languageName,
  type WosLanguage,
} from './language-dictionary';
import { getSymptomSearchAliases } from './symptom-intent';
import { deriveWosJourneyState, formatJourneyState, getWosConciergeStage } from './journey-state';
import { buildHandoffConfirmation } from '@/lib/handoff/concierge';

// Lazy: `new OpenAI()` throws when OPENAI_API_KEY is missing, and doing that
// at module scope made `next build` fail whenever the key was not present in
// the build environment. Creating the client on first use keeps builds
// independent of runtime secrets.
// gpt-5.6-luna defaults to "medium" reasoning, which took ~10s per answer.
// Customer chat is mostly lookup + summarise, so start at "low". Supported
// values for this model: none | low | medium | high | xhigh | max.

let openaiClient: OpenAI | null = null;

function runtimeEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  return value.replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
}

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = runtimeEnv('LITELLM_API_KEY') || runtimeEnv('OPENAI_API_KEY');
    const baseURL = runtimeEnv('LITELLM_BASE_URL');
    openaiClient = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      maxRetries: 0,
    });
  }
  return openaiClient;
}

/**
 * WOS AI tools
 *
 * searchPrograms
 * ค้นหาโปรแกรมที่ published + active
 *
 * getProgramDetails
 * ดึงรายละเอียดโปรแกรมที่ได้จาก searchPrograms
 */
const tools = [
  {
    type: 'function' as const,
    name: 'searchPrograms',
    description:
      'Search currently published and active WOS programs, packages, and services. Use this when the customer asks what programs or services are available, wants to find a suitable program, or mentions a service category, wellness service, clinic, hotel, transport, package, or treatment. Never invent program information when this tool returns no result.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Short search keyword in THAI describing the SERVICE only (for example "knee check" -> "ตรวจเข่า", "dental implant" -> "รากฟันเทียม"), even when the customer writes in English or Lao. Prefer 1-3 words. Do NOT put a province/location name here - if the customer mentioned one, put it in the separate "province" field instead. Never silently drop a province the customer mentioned; it must always end up in "province".',
        },
        province: {
          type: ['string', 'null'],
                  description:
            'The Thai province the customer is asking about, in THAI. Use a province from the latest customer message when one is explicitly named. Do NOT inherit a province from earlier turns for a new broad/overview question such as which provinces are available or what programs/services are available generally. Historical context may guide continuity only when the latest message is clearly a follow-up to the same selected program or location.'
      },
      limit: {
          type: 'integer',
          description:
            'Maximum number of search results. Use 5 or fewer.',
          minimum: 1,
          maximum: 5,
        },
      },
      required: ['query', 'province', 'limit'],
      additionalProperties: false,
    },
  },

  {
    type: 'function' as const,
    name: 'searchHotelAvailability',
    description:
      'Check REAL hotel room availability for exact check-in/check-out dates. Use this when the customer asks whether a hotel room is available, wants to stay somewhere on specific dates, or asks for rooms/hotels with availability. Never invent availability, price, hotel names, or dates. This tool is READ-ONLY: it does not create a booking.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        province: { type: 'string', description: 'Thai province for the hotel search.' },
        checkin: { type: 'string', description: 'Check-in date in YYYY-MM-DD.' },
        checkout: { type: 'string', description: 'Check-out date in YYYY-MM-DD.' },
        rooms: { type: 'integer', description: 'Number of rooms requested.', minimum: 1, maximum: 10 },
        limit: { type: 'integer', description: 'Maximum hotels to return.', minimum: 1, maximum: 5 },
      },
      required: ['province', 'checkin', 'checkout', 'rooms', 'limit'],
      additionalProperties: false,
    },
  },

  {
    type: 'function' as const,
    name: 'getProgramDetails',
    description:
      'Get detailed information about one specific published and active WOS program/package/service. Use this after searchPrograms when the customer wants more information about a specific program. Only use a program ID returned by searchPrograms. Never invent a program ID or program details.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        programId: {
          type: 'string',
          description:
            'The exact program ID returned by searchPrograms.',
        },
      },
      required: ['programId'],
      additionalProperties: false,
    },
  },

  // typhoon2-8b's Ollama template rewrites the last user message to "respond
  // with a JSON for a function call" whenever tools are attached, so the model
  // cannot answer a greeting / contact question in plain text. This no-op tool
  // gives it a legal way to say "no lookup needed"; core.ts then re-asks the
  // model WITHOUT tools so it answers in natural language.
  {
    type: 'function' as const,
    name: NO_LOOKUP_TOOL,
    description:
      'Call this ONLY when the customer message does NOT ask about programs, packages, services, treatments, prices, clinics, hotels or transport: for example a greeting, thanks, a request for contact details, or a general question. If the message mentions any program or service, call searchPrograms instead.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'One short phrase saying why no program lookup is needed.',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
] as const;

/**
 * Appended to every successful tool result. Small local models tend to echo
 * the raw JSON back instead of answering; this states the required output
 * form right next to the data they are looking at.
 */
const ANSWER_INSTRUCTION =
  'Now answer the customer in plain natural language in the customer\'s language. Do NOT output JSON, field names, or code. Mention the program name, the provider (partner) name, the province, the price (show the special_price as the current price and original_price as the regular price if is_promotion is true) and the duration when available. If the customer stated a goal, symptom, budget, timing, province, or travel need, explicitly connect the verified result to that need in one short sentence and explain the concrete reason it matches; never invent a medical diagnosis, benefit, or suitability claim. When multiple results are relevant, compare the factual differences instead of blindly listing them, and let the customer choose. Do not show internal ids or image links. Do not call another tool unless the answer still needs one. If the customer is speaking Thai, answer as Fern using feminine Thai phrasing (ค่ะ/คะ when appropriate); never use ครับ or ผม. Keep the wording conversational rather than sounding like a database record.';

function normalizeFernThaiReply(text: string, isThaiConversation: boolean): string {
  if (!isThaiConversation || !/[\u0E00-\u0EFF]/.test(text)) return text;
  // Typhoon-local can ignore the female-persona instruction even when the
  // system prompt is explicit. Normalize only the assistant's final text;
  // customer wording/history is never modified.
  return text
    .replace(/ผม(?=\s*(?:ช่วย|ขอ|แนะนำ|คิดว่า|ขอเสนอ|สามารถ))/g, 'ใบเฟิร์น')
    .replace(/ครับ/g, 'ค่ะ');
}

// Small local models can occasionally fall into a repetition loop, especially
// in Lao multi-turn conversations. Never send an obviously corrupted loop to
// the customer. This is deliberately structural rather than language-specific
// so it protects Thai/Lao/English equally without trying to judge wording.
function looksLikeRepeatedLoop(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length < 80) return false;

  // Same 20+ character phrase repeated three or more times is a strong signal
  // of the failure mode we have observed from Typhoon/Ollama.
  for (let size = 20; size <= 80; size += 10) {
    for (let start = 0; start + size <= normalized.length; start += 5) {
      const chunk = normalized.slice(start, start + size);
      if (chunk.length < 20) continue;
      const occurrences = normalized.split(chunk).length - 1;
      if (occurrences >= 3) return true;
    }
  }

  // Guard against a single very long answer made almost entirely from the
  // same short phrase separated by punctuation/spaces.
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 18) {
    const counts = new Map<string, number>();
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    const maxCount = Math.max(...counts.values());
    if (maxCount >= 8 && maxCount / words.length >= 0.35) return true;
  }

  return false;
}

/**
 * Smart escalation guard:
 * The model is allowed to answer unknown questions from verified Notion
 * knowledge, but if it falls back to a generic refusal on a WOS question,
 * Fern should turn that dead-end into a useful human handoff.
 *
 * This runs only when the customer is clearly asking about WOS itself and
 * the generated answer is a refusal/knowledge-gap. It does not intercept
 * normal catalog, health, travel, or small-talk replies.
 */
function shouldEscalateWosGap(userMessage: string, finalText: string): boolean {
  const user = userMessage.trim();
  const reply = finalText.trim();

  const asksAboutWos =
    /\bWOS\b|wos\.asia|wellness operating system|(?:ทีม|ระบบ|บริการ|นโยบาย|ขั้นตอน|การจอง|ติดต่อ|ประสานงาน).*WOS/iu.test(user);

  if (!asksAboutWos) return false;

  const refusalOrGap =
    /(?:cannot|can't|unable|don't know|do not know|not sure|not available|no information|policy says|not supported|ไม่สามารถ|ตอบไม่ได้|ไม่ทราบ|ยังไม่มีข้อมูล|ไม่มีข้อมูล|ยืนยันไม่ได้|ไม่แน่ใจ|ไม่มีบริการ)/iu.test(reply);

  return refusalOrGap;
}

function buildSmartWosEscalation(language: WosLanguage): string {
  if (language === 'lo') {
    return 'ຂໍໂທດຄ່ະ ເລື່ອງນີ້ໃບເຟີນຍັງບໍ່ມີຂໍ້ມູນທີ່ຢືນຢັນໄດ້ ຈຶ່ງບໍ່ຢາກເດົາໃຫ້ຜິດ. ໃບເຟີນຈະໃຫ້ທີມ WOS ກວດສອບ ແລະປະສານຕໍ່ໃຫ້ຄ່ະ';
  }
  if (language === 'en') {
    return 'I don’t have verified information for that yet, so I don’t want to guess. I’ll have the WOS team verify it and follow up with you.';
  }
  return 'เรื่องนี้ใบเฟิร์นยังไม่มีข้อมูลที่ยืนยันได้ค่ะ เลยไม่อยากเดาให้ผิด เดี๋ยวใบเฟิร์นให้ทีม WOS ตรวจสอบและประสานต่อให้ค่ะ';
}

function isJourneyDataUpdate(message: string): boolean {
  return /(?:งบ(?:ประมาณ)?\s*\d|งบไม่จำกัด|งบไม่กำหนด|\d+\s*บาท|\d+\s*คน|วันที่\s*\d|วัน\s*ที่\s*\d|เดินทางวันที่|งบ\s*\d)/iu.test(message);
}

function buildJourneyDataUpdateReply(
  message: string,
  state: ReturnType<typeof deriveWosJourneyState>,
  language: WosLanguage
): string | null {
  // Once a health program is selected, date/time/name updates belong to the
  // booking flow. Never route them into the generic trip planner.
  if (state.selectedProgram && (state.serviceDate || state.serviceTime || state.customerName)) return null;
  if (!isJourneyDataUpdate(message)) return null;
  if (language === 'lo') return 'ຮັບຊາບຄ່ະ 😊';
  if (language === 'en') return 'Got it 😊';
  const details = [
    state.travelers ? `${state.travelers} คน` : '',
    state.budgetThb ? `งบ ${state.budgetThb.toLocaleString('th-TH')} บาท` : '',
    state.budgetUnlimited ? 'งบไม่จำกัด' : '',
    state.serviceDate ? `วันที่ ${state.serviceDate.replace(/^วันที่\s*/iu, '')}` : '',
    state.tripDurationDays ? `${state.tripDurationDays} วัน` : '',
  ].filter(Boolean).join(' · ');
  return details
    ? `รับทราบค่ะ 😊 ${details}`
    : 'รับทราบค่ะ 😊';
}

function isJourneyPlanningFollowUp(message: string): boolean {
  return /(?:ต้องการข้อมูลอะไร|ต้องใช้ข้อมูลอะไร|ข้อมูลอะไรอีก|บอกไปแล้ว|ต่อไปเลย|ไปต่อ|ดำเนินการต่อ|สรุปให้หน่อย|สรุปข้อมูล|พร้อมให้ทีม|ส่งทีม|ติดต่อทีม|ต้องการรถรับส่ง|ต้องการรถ|ต้องการโรงแรม|ต้องการที่พัก)/iu.test(message);
}

function buildJourneyPlanningReply(userMessage: string, state: ReturnType<typeof deriveWosJourneyState>, language: WosLanguage): string | null {
  if (state.selectedProgram) return null;
  if (!isJourneyPlanningFollowUp(userMessage)) return null;
  // V1 concierge deliberately collects only the minimum front-desk data.
  // Admin will collect dates, travelers, budget, drop-off, room type, etc. after handoff.
  const missing: string[] = [];
  if (!state.customerName) missing.push('ชื่อผู้จอง');
  const known = [
    state.selectedProgram ? `โปรแกรม: ${state.selectedProgram}` : '',
    state.destination ? `ปลายทาง: ${state.destination}` : '',
    state.serviceDate ? `วันที่: ${state.serviceDate.replace(/^วันที่\s*/iu, '')}` : '',
    state.tripDurationDays ? `ระยะเวลา: ${state.tripDurationDays} วัน` : '',
    state.travelers ? `ผู้เดินทาง: ${state.travelers} คน` : '',
    state.budgetThb ? `งบประมาณ: ${state.budgetThb.toLocaleString('th-TH')} บาท` : '',
    state.budgetUnlimited ? 'งบประมาณ: ไม่จำกัด' : '',
    state.needs.includes('transport') ? 'รถรับส่ง: ต้องการ' : '',
    state.needs.includes('hotel') ? 'โรงแรม: ต้องการ' : '',
  ].filter(Boolean);
  if (language === 'en') {
    if (missing.length) return `Got it 😊 I already have: ${known.join(' · ')}. I only still need: ${missing.join(', ')}.`;
    return `Perfect 😊 Here is the request summary:\n${known.map((x) => `• ${x}`).join('\n')}\n\nFern will pass this summary to the WOS team. The team will contact you within 2 hours to confirm the final details.`;
  }
  if (language === 'lo') {
    if (missing.length) return `ຮັບຊາບຄ່ະ 😊 ໃບເຟີນມີຂໍ້ມູນແລ້ວ: ${known.join(' · ')}. ຍັງຂາດ: ${missing.join(', ')}.`;
    return `ຮຽບຮ້ອຍຄ່ະ 😊 ສະຫຼຸບຄຳຂໍ:\n${known.map((x) => `• ${x}`).join('\n')}\n\nໃບເຟີນຈະສົ່ງໃຫ້ທີມ WOS ແລະ ທີມງານຈະຕິດຕໍ່ພາຍໃນ 2 ຊົ່ວໂມງເພື່ອຢືນຢັນລາຍລະອຽດ.`;
  }
  if (missing.length) return `ได้เลยค่ะ 😊 ใบเฟิร์นมีข้อมูลแล้ว: ${known.join(' · ')}\n\nตอนนี้ยังขาดแค่: ${missing.join(', ')} ค่ะ พอข้อมูลครบ ใบเฟิร์นจะสรุปเป็นคำขอเดียวให้ทีม WOS ติดต่อกลับค่ะ`;
  return `เรียบร้อยค่ะ 😊 ใบเฟิร์นสรุปข้อมูลให้ก่อนนะคะ\n\n${known.map((x) => `• ${x}`).join('\n')}\n\nใบเฟิร์นจะส่งสรุปนี้ให้ทีม WOS เพื่อดำเนินการต่อ และทีมงานจะติดต่อกลับภายใน 2 ชั่วโมงเพื่อยืนยันรายละเอียดบริการ รถรับส่ง โรงแรม และค่าใช้จ่ายสุดท้ายค่ะ`;
}

function buildTripPlanningReply(
  userMessage: string,
  state: ReturnType<typeof deriveWosJourneyState>,
  language: WosLanguage
): string | null {
  const hasTripDuration = Boolean(state.tripDurationDays);
  const asksTrip = hasTripDuration &&
    /(?:ไป|เที่ยว|พัก|ทริป).*(?:อุดร|อุดรธานี)|(?:อุดร|อุดรธานี).*(?:วัน|คืน|ทริป)|(?:trip|travel).*(?:udon|days?|three days)|(?:ອຸດອນ).*(?:ມື້|ທ່ຽວ)/iu.test(userMessage);
  if (!asksTrip) return null;

  const days = state.tripDurationDays ?? 1;
  if (language === 'lo') {
    return `ໄດ້ເລີຍຄ່ະ 😊 ຖ້າຈະໄປອຸດອນ ${days} ມື້ ໃບເຟີນຊ່ວຍວາງແຜນໃຫ້ໄດ້ຄ່ະ. ບອກວັນທີ່ຈະໄປ ແລະສິ່ງທີ່ສົນໃຈ ເຊັ່ນ ສຸຂະພາບ, ອາຫານ, ທ່ຽວ ຫຼື ຊອບປິ້ງໄດ້ເລີຍຄ່ະ`;
  }
  if (language === 'en') {
    return `Absolutely 😊 If you are going to Udon for ${days} day${days === 1 ? '' : 's'}, Fern can help shape the trip around your needs. Please tell me your travel date and what you care about most — health, food, sightseeing, shopping, or a mix.`;
  }
  return `ได้เลยค่ะ 😊 ถ้าจะไปอุดร ${days} วัน ใบเฟิร์นช่วยวางแผนให้เข้ากับสิ่งที่คุณต้องการได้ค่ะ บอกวันเดินทางและสิ่งที่สนใจเป็นหลัก เช่น สุขภาพ อาหาร เที่ยว ช้อปปิ้ง หรืออยากผสมหลายอย่างได้เลยค่ะ`;
}

function shouldResetHistoricalProvince(message: string): boolean {
  const hasExplicitProvince = detectLocationFromRawText(message).length > 0;
  if (hasExplicitProvince) return false;
  const asksProvinceOverview = /\u0e08\u0e31\u0e07\u0e2b\u0e27\u0e31\u0e14.*(?:\u0e2b\u0e19\u0e32\u0e22|\u0e2d\u0e30\u0e44\u0e23|\u0e44\u0e2b\u0e19|\u0e1a\u0e49\u0e32\u0e07)|(?:\u0e21\u0e35|\u0e43\u0e2b\u0e49\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23).*\u0e08\u0e31\u0e07\u0e2b\u0e27\u0e31\u0e14/i.test(message);
  if (asksProvinceOverview) return true;
  return /(?:\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21|\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23).*(?:\u0e2d\u0e30\u0e44\u0e23|\u0e44\u0e2b\u0e19|\u0e1a\u0e49\u0e32\u0e07|\u0e41\u0e19\u0e30\u0e19\u0e33)|(?:what programs|what services|available programs|available services|which provinces|what provinces)/i.test(message);
}
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  // The customer's own latest message, verbatim from the request body.
  // Unlike query/province below, this text never passes through the
  // model's tool-call JSON generation, so it cannot suffer the same
  // mistranslation/mojibake corruption - see the fallback below.
  rawUserMessage: string
) {
  /**
   * ---------------------------------------------------------
   * searchPrograms
   * ---------------------------------------------------------
   */
  if (name === 'searchPrograms') {
    const rawQuery = String(args.query ?? '').trim();
    // args.province is `null` (not undefined) when the model omits a
    // province, per the tool's ["string","null"] schema - String(null)
    // would otherwise turn that into the literal text "null".
    const rawProvinceValue = args.province == null ? '' : String(args.province).trim();
    const rawProvince = /^(?:null|undefined)$/i.test(rawProvinceValue) ? '' : rawProvinceValue;
    const ignoreHistoricalProvince = shouldResetHistoricalProvince(rawUserMessage);
    const effectiveProvince = ignoreHistoricalProvince ? '' : rawProvince;

    const limit = Math.min(
      Math.max(Number(args.limit ?? 5), 1),
      5
    );

    const provinceOverview = /(?:มี|ขอ|อยากทราบ|บอก)\s*(?:จังหวัด|จังหวัดไหน|จังหวัดอะไร)/i.test(rawUserMessage)
      || /which provinces|what provinces/i.test(rawUserMessage);

    if (provinceOverview) {
      const provinces = await getCatalogProvinces();
      console.log('[WOS_AI_TOOL] province overview:', JSON.stringify({ count: provinces.length }));
      return {
        success: true,
        count: provinces.length,
        provinces,
        items: [],
        instruction: 'Answer the customer in natural language. This is the verified list of provinces currently represented by active WOS catalog programs. List the provinces clearly. Do not invent provinces or add provinces that are not in the verified list. If the list is empty, say WOS is checking the current catalog.',
      };
    }

    if (!rawQuery) {
      return {
        success: false,
        items: [],
        message: 'Search query is empty.',
      };
    }

    // Detect the two observed Typhoon/LiteLLM tool-calling failures for
    // Thai string args (see tool-guard.ts): mojibake (a UTF-8 <->
    // Latin-1/CP1252 mis-decode, e.g. province="Ó©...") or a silent
    // translation to another script despite the schema requiring Thai
    // (e.g. query="health check"). Log the raw values either way - this is
    // the decisive signal for root-causing where in the pipeline
    // (Typhoon/Ollama vs LiteLLM vs our own parsing) the corruption enters.
    const rawUserHasThai = /[\u0E00-\u0E7F]/.test(rawUserMessage);
    const queryLanguageMismatch =
      rawUserHasThai &&
      /[A-Za-z]/.test(rawQuery) &&
      !/[\u0E00-\u0E7F]/.test(rawQuery);
    const provinceLanguageMismatch =
      rawUserHasThai &&
      !!effectiveProvince &&
      /[A-Za-z]/.test(rawProvince) &&
      !/[\u0E00-\u0E7F]/.test(rawProvince);

    const queryBad =
      looksCorruptedOrMistranslated(rawQuery) || queryLanguageMismatch;
    const provinceBad =
      (!!effectiveProvince && looksCorruptedOrMistranslated(effectiveProvince)) ||
      provinceLanguageMismatch;

    if (queryBad || provinceBad) {
      console.warn(
        '[WOS_AI_TOOL_ARG_CORRUPTED]',
        JSON.stringify({
          queryBad,
          provinceBad,
        })
      );
    }

    // The model is asked to send the service keyword and the province as
    // two separate structured fields (see the tool schema above) precisely
    // so a province can never be silently dropped from a free-text query.
    // searchPrograms()/detectLocation() in programs.ts scan the combined
    // string for a known province name, so recombine them here before the
    // lookup - the two fields are search *input*, not independent filters.
    //
    // When either field looks corrupted/mistranslated, prefer the
    // customer's own raw message instead: programs.ts's detectLocation()/
    // buildSearchCandidates() are already built to parse natural language
    // directly, so the raw message alone is enough to search on, and it is
    // guaranteed not to carry the corruption that broke query/province.
    const symptomAliases = getSymptomSearchAliases(rawUserMessage);
    const symptomOverride = symptomAliases[0] ?? '';
    const query = queryBad ? '' : (ignoreHistoricalProvince ? 'available programs' : rawQuery);
    const province = provinceBad ? '' : effectiveProvince;
    const searchQuery = symptomOverride
      ? (symptomOverride + (province ? ' ' + province : '')).trim()
      : queryBad || provinceBad
        ? rawUserMessage || (province ? query + ' ' + province : query)
        : province
          ? (query + ' ' + province).trim()
          : query;

    console.log(
      '[WOS_AI_TOOL] searchPrograms args:',
      JSON.stringify({
        queryPresent: Boolean(rawQuery),
        provincePresent: Boolean(effectiveProvince),
        searchQueryLength: searchQuery.length,
        usedFallback: queryBad || provinceBad,
      })
    );

    const items = await searchPrograms(searchQuery, limit);

    console.log('[WOS_AI_TOOL] searchPrograms count:', items.length);

    return {
      success: true,
      count: items.length,
      items,
      ...(items.length > 0 ? { instruction: ANSWER_INSTRUCTION } : {}),
    };
  }

  /**
   * ---------------------------------------------------------
   * searchHotelAvailability
   * ---------------------------------------------------------
   */
  if (name === 'searchHotelAvailability') {
    const detectedProvinces = detectLocationFromRawText(rawUserMessage);
    const rawDetectedProvince = detectedProvinces[0] ?? '';
    const modelProvince = String(args.province ?? '').trim();
    const province = rawDetectedProvince || modelProvince;
    const checkin = String(args.checkin ?? '').trim();
    const checkout = String(args.checkout ?? '').trim();
    const rawRoomMatch = rawUserMessage.match(/(?:^|\\s)(\\d{1,2})\\s*(?:ห้อง|room|rooms)\\b/i);
    const rawRooms = rawRoomMatch ? Number(rawRoomMatch[1]) : null;
    const modelRooms = Number(args.rooms ?? 1);
    const rooms = Math.min(Math.max(rawRooms && Number.isFinite(rawRooms) ? rawRooms : modelRooms, 1), 10);
    const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 5);

    if (!province || !/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
      return {
        success: false,
        items: [],
        message: 'Hotel availability requires a province and exact check-in/check-out dates in YYYY-MM-DD.',
      };
    }

    const items = await searchHotelAvailability({ province, checkin, checkout, rooms, limit });
    return {
      success: true,
      count: items.length,
      items,
      instruction:
        'Answer naturally. This is verified READ-ONLY hotel availability for the requested dates. Never say a room is available unless it appears in these results. Mention hotel/partner name, room type when available, dates, rooms, price per night and estimated total when provided. If a single nightly price cannot be established, say the nightly rate varies and do not invent a total. Do not create a booking or claim that a booking was made.',
    };
  }

  /**
   * ---------------------------------------------------------
   * getProgramDetails
   * ---------------------------------------------------------
   */
  if (name === 'getProgramDetails') {
    const programId = String(
      args.programId ?? ''
    ).trim();

    if (!programId) {
      return {
        success: false,
        item: null,
        message: 'Program ID is empty.',
      };
    }

    const item = await getProgramDetails(programId);

    console.log('[WOS_AI_TOOL] getProgramDetails found:', Boolean(item));

    if (!item) {
      return {
        success: false,
        item: null,
        message:
          'Published active program not found.',
      };
    }

    return {
      success: true,
      item,
      instruction: ANSWER_INSTRUCTION,
    };
  }

  throw new Error(
    `Unknown WOS AI tool: ${name}`
  );
}

/**
 * ---------------------------------------------------------
 * Usage accounting
 * ---------------------------------------------------------
 */
type UsageTotals = {
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

function createUsageTotals(): UsageTotals {
  return {
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

// One customer question can cost several OpenAI requests (first call + one
// per tool round), and the full instructions are re-sent on each of them.
// Track the totals so quota/cost problems are visible in the logs.
// Avoid dumping the whole SDK error (it includes every response header,
// including Set-Cookie) into the logs.
function describeError(error: unknown) {
  const e = error as { status?: number; code?: string; message?: string };
  return {
    status: e?.status,
    code: e?.code,
    message: e?.message ?? String(error),
  };
}

function addChatUsage(
  totals: UsageTotals,
  response: {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: {
        cached_tokens?: number;
      } | null;
      completion_tokens_details?: {
        reasoning_tokens?: number;
      } | null;
    };
  }
) {
  totals.requests += 1;

  const u = response.usage;
  if (!u) return;

  totals.inputTokens += u.prompt_tokens ?? 0;
  totals.cachedInputTokens +=
    u.prompt_tokens_details?.cached_tokens ?? 0;
  totals.outputTokens += u.completion_tokens ?? 0;
  totals.reasoningTokens +=
    u.completion_tokens_details?.reasoning_tokens ?? 0;
  totals.totalTokens += u.total_tokens ?? 0;
}

/**
 * Maximum number of tool rounds allowed for one customer message.
 *
 * Typical path: searchPrograms -> getProgramDetails -> final answer.
 * 3 rounds also allows the documented broader-keyword retry.
 */
const MAX_TOOL_ROUNDS = 3;

/**
 * How many times to re-ask the model when its answer is a tool call written
 * out as plain text (see leak-guard.ts). After this, send the fallback
 * message instead of the leaked text.
 */
const MAX_LEAK_RETRIES = 1;

export type WosAIHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ConversationOption = {
  index: number;
  label: string;
};

function extractRecentConversationOptions(
  history: WosAIHistoryMessage[]
): ConversationOption[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.role !== 'assistant') continue;

    const options: ConversationOption[] = [];
    const re = /^\s*(\d+)[.)]\s*(.+)$/gm;
    for (const match of message.content.matchAll(re)) {
      const index = Number(match[1]);
      const raw = match[2]?.trim();
      if (!Number.isInteger(index) || index < 1 || !raw) continue;

      // Keep the human-facing label compact. Program lists normally use
      // "ชื่อโปรแกรม — Partner / จังหวัด"; the full line is still useful
      // to the model, but the title is what we use for deterministic
      // selection recovery.
      const label = raw.split(/\s+—\s+|\s+-\s+/)[0]?.trim() || raw;
      options.push({ index, label });
    }

    if (options.length >= 1) return options.slice(0, 5);
  }

  return [];
}

function isAmbiguousProgramFollowUp(
  message: string,
  options: ConversationOption[]
): boolean {
  if (options.length < 2) return false;
  const text = message.trim().toLowerCase();
  if (!text) return false;

  const explicitSelection =
    /^(?:\d+|อันที่\s*\d+|ตัวที่\s*\d+|อันแรก|ตัวแรก|อันที่สอง|ตัวที่สอง|อันที่สาม|ตัวที่สาม|ອັນທີ່?\s*\d+|ຕົວທີ່?\s*\d+|ອັນທຳອິດ|ຕົວທຳອິດ)$/u.test(
      text
    );

  if (explicitSelection) return false;

  return [
    'สนใจ',
    'สนใจต้องทำไง',
    'ต้องทำไง',
    'ทำไงต่อ',
    'แล้วทำไง',
    'อยากจอง',
    'จองยังไง',
    'ต้องจองยังไง',
    'ราคาเท่าไหร่',
    'รายละเอียดเป็นยังไง',
    'มีอะไรบ้าง',
    'ສົນໃຈ',
    'ສົນໃຈຕ້ອງເຮັດແນວໃດ',
    'ຕ້ອງເຮັດແນວໃດ',
    'ເຮັດແນວໃດຕໍ່',
    'ຢາກຈອງ',
    'ຈະຈອງແນວໃດ',
    'ລາຄາເທົ່າໃດ',
  ].some((phrase) => text.includes(phrase));
}

function parseProgramSelection(
  message: string,
  options: ConversationOption[]
): ConversationOption | null {
  if (options.length === 0) return null;
  const text = message.trim().toLowerCase();

  const directNumber = text.match(/^(\d+)$/);
  const namedNumber = text.match(/^(?:อันที่|ตัวที่)\s*(\d+)$/u) ??
    text.match(/^(?:ອັນທີ່|ຕົວທີ່|ອັນທີ|ຕົວທີ)\s*(\d+)$/u);
  const aliases: Record<string, number> = {
    'อันแรก': 1,
    'ตัวแรก': 1,
    'ອັນທຳອິດ': 1,
    'ຕົວທຳອິດ': 1,
    'ອັນທີ່ສອງ': 2,
    'ຕົວທີ່ສອງ': 2,
    'ອັນທີ່ສາມ': 3,
    'ຕົວທີ່ສາມ': 3,
    'อันที่สอง': 2,
    'ตัวที่สอง': 2,
    'อันที่สาม': 3,
    'ตัวที่สาม': 3,
  };

  const index = directNumber
    ? Number(directNumber[1])
    : namedNumber
      ? Number(namedNumber[1])
      : aliases[text];

  if (!index) return null;
  return options.find((option) => option.index === index) ?? null;
}

function resolveProgramSelection(
  message: string,
  history: WosAIHistoryMessage[],
  options: ConversationOption[]
): ConversationOption | null {
  const current = parseProgramSelection(message, options);
  if (current) return current;

  // Keep the selected program active for later short follow-ups such as
  // "ราคาเท่าไหร่" or "ต้องติดต่อใคร". Find the most recent multi-option
  // assistant list, then inspect the turns AFTER that list for the latest
  // explicit selection.
  let optionListIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item.role === 'assistant' && extractRecentConversationOptions([item]).length >= 2) {
      optionListIndex = i;
      break;
    }
  }

  if (optionListIndex >= 0) {
    for (let i = optionListIndex + 1; i < history.length; i++) {
      const item = history[i];
      if (item.role !== 'user') continue;
      const selected = parseProgramSelection(item.content, options);
      if (selected) return selected;
    }
  }

  // Never treat a single assistant catalog result as a customer selection.
  // A new topic must be able to replace the active intent; only an explicit
  // customer selection keeps a program active for later follow-ups.

  // Fallback for integrations that trim/reorder history around assistant
  // replies: the latest explicit numeric user selection still wins.
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue;
    const selected = parseProgramSelection(history[i].content, options);
    if (selected) return selected;
  }

  return null;
}

function isHealthServiceOverview(message: string): boolean {
  return /(?:บริการ|โปรแกรม|ตรวจ|ด้านสุขภาพ|สุขภาพ).*(?:สุขภาพ|มีอะไรบ้าง|อะไรบ้าง)|(?:health services|health programs|health check|wellness services|what services)|(?:ບໍລິການ|ໂປຣແກຣມ|ກວດ|ສຸຂະພາບ).*(?:ສຸຂະພາບ|ຫຍັງແດ່|ມີຫຍັງ)/iu.test(message);
}

function isProgramOverviewQuestion(message: string): boolean {
  if (/(?:ໂປຣແກຣມ|ໂຄງການ|ບໍລິການ|ແຂວງ|ແຂວງໃດ)/iu.test(message)) return true;
  return /(?:มี|ขอ|อยากทราบ).*(?:โปรแกรม|บริการ).*(?:อะไร|อะไรบ้าง|ไหน|บ้าง)|(?:โปรแกรม|บริการ).*(?:อะไรบ้าง|ไหนบ้าง|มีอะไร)|(?:what|which).*(?:program|service)|(?:ມີ|ຂໍ|ຢາກຮູ້).*(?:ໂຄງການ|ໂປຣແກຣມ|ບໍລິການ).*(?:ຫຍັງ|ໃດ|ແດ່)|(?:ໂຄງການ|ໂປຣແກຣມ|ບໍລິການ).*(?:ຫຍັງແດ່|ໃດແດ່)/iu.test(message);
}

function isHotelRequirementQuestion(message: string): boolean {
  return /(?:โรงแรม|ที่พัก|ห้องพัก|ห้องเตียง|hotel|accommodation|room|stay|ກະໂຮງແຮມ|ໂຮງແຮມ|ທີ່ພັກ|ຫ້ອງພັກ|ຕຽງ)/iu.test(message);
}

function isTreatmentJourneyQuestion(message: string): boolean {
  return /(?:อยากไปรักษา|ต้องการรักษา|ไปรักษา|รักษาที่ไหน|พบแพทย์|หาหมอ|ปรึกษาหมอ|ผ่าตัด|treatment|see a doctor|doctor consultation|surgery|ຢາກໄປຮັກສາ|ຕ້ອງການຮັກສາ|ໄປຮັກສາ|ພົບໝໍ|ປຶກສາໝໍ|ຜ່າຕັດ)/iu.test(message);
}

function isBookingProcessQuestion(message: string): boolean {
  return /(?:ขั้นตอน(?:จอง|การจอง)?|จองยังไง|จองอย่างไร|ต้องทำยังไง.*จอง|ทำยังไง.*จอง|booking process|how.*book|how.*booking|ຂັ້ນຕອນ.*ຈອງ|ຈອງແນວໃດ|ຈະຈອງແນວໃດ)/iu.test(message);
}

// =====================================================
// Dynamic contact-info block from Supabase `bot_config`.
//
// Without this the model guesses contact channels (e.g. a LINE OA from the
// domain name, or that no WhatsApp exists). Cached for 60s so it does not
// query Supabase on every message. `bot_config` is readable by the service
// role only, so createServiceClient() is required.
// =====================================================
type BotConfigRow = { key: string; value: string };
let botConfigCache: { block: string; fetchedAt: number } | null = null;
const BOT_CONFIG_TTL_MS = 60_000;

async function getContactInfoBlock(): Promise<string> {
  const now = Date.now();
  if (botConfigCache && now - botConfigCache.fetchedAt < BOT_CONFIG_TTL_MS) {
    return botConfigCache.block;
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('bot_config')
      .select('key, value');

    if (error || !data) {
      console.error('[ai-core] failed to load bot_config', error?.message);
      // A stale cached block beats no contact info at all.
      return botConfigCache?.block ?? '';
    }

    const cfg: Record<string, string> = {};
    for (const row of data as BotConfigRow[]) cfg[row.key] = row.value;

    const block = `VERIFIED CONTACT INFORMATION (use only when the customer asks for a contact channel — never invent a channel not listed here, e.g. do not claim Facebook/Telegram exist if not listed):
- Phone (Thailand): ${cfg.contact_phone_th ?? 'not available'}
- Phone (Laos): ${cfg.contact_phone_la ?? 'not available'}
- LINE OA: ${cfg.contact_line_id ?? 'not available'} (link: ${cfg.contact_line_url ?? ''})
- WhatsApp: ${cfg.contact_whatsapp_url ? `available (link: ${cfg.contact_whatsapp_url})` : 'not available'}
- Email: ${cfg.contact_email ?? 'not available'}`;

    botConfigCache = { block, fetchedAt: now };
    return block;
  } catch (err) {
    console.error(
      '[ai-core] getContactInfoBlock error',
      err instanceof Error ? err.message : String(err)
    );
    return botConfigCache?.block ?? '';
  }
}

export async function runWosAI(
  userMessage: string,
  // Optional prior turns of this conversation, oldest first. AI Core
  // owns context assembly — callers (the Chatwoot webhook, /api/ai/chat)
  // pass raw history; they must not build their own prompt around it.
  // Defaults to [] so existing single-string call sites keep working.
  history: WosAIHistoryMessage[] = []
) {
  try {
    // Symptom intent has priority over broad catalog wording. A message
    // such as "ปวดเข่า...มีโปรแกรมอะไรที่เกี่ยวข้องไหม" is asking for a
    // relevant service, not a province/program overview.
    const topSymptomAlias = getSymptomSearchAliases(userMessage)[0];
    if (topSymptomAlias) {
      try {
        const province = detectLocationFromRawText(userMessage)[0] ?? '';
        const items = await searchPrograms([topSymptomAlias, province].filter(Boolean).join(' '), 5);
        if (items.length > 0) {
          const answer = buildProgramAnswer(items, userMessage, '', detectWosLanguage(userMessage));
          if (answer) return answer;
        }
      } catch (symptomError) {
        console.warn('[WOS_AI_TOP_SYMPTOM_LOOKUP_FAILED]', symptomError instanceof Error ? symptomError.message : String(symptomError));
      }
    }

    // Deterministic catalog overview: this question is a direct request for
    // the current province coverage, so do not let the local model turn it
    // into a generic greeting or an unrelated program search.
    if (/(?:มี|ขอ|อยากทราบ|บอก).*จังหวัด|จังหวัด.*(?:ไหน|อะไร|บ้าง)/i.test(userMessage)) {
      const provinces = await getCatalogProvinces();
      if (provinces.length === 0) {
        return 'ตอนนี้ยังไม่พบข้อมูลจังหวัดจากแคตตาล็อกที่เผยแพร่ค่ะ ขอให้ทีม WOS ตรวจสอบข้อมูลให้เพิ่มเติมนะคะ';
      }
      return 'ตอนนี้ WOS มีโปรแกรม/บริการที่เผยแพร่อยู่ใน ' + provinces.length + ' จังหวัดค่ะ ได้แก่ ' + provinces.join(', ') + ' 😊';
    }

    /**
     * -------------------------------------------------------
     * 1. Retrieve verified WOS knowledge from Notion
     * -------------------------------------------------------
     */
    // Neither lookup may take the assistant down: on failure the model just
    // gets no knowledge / no contact block (and is told to say so).
    // Keep the latency-critical catalog/concierge path independent from
    // Notion and bot_config network lookups. Those sources are only needed
    // for knowledge/contact questions; verified catalog answers come from
    // Supabase-backed tools below.
    const needsContactInfo = /(?:\u0e42\u0e17\u0e23|\u0e40\u0e1a\u0e2d\u0e23|\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d|\u0e44\u0e25\u0e19\u0e4c|line|whatsapp|email|\u0e2d\u0e35\u0e40\u0e21\u0e25|contact|phone|\u0e95\u0e34\u0e14\u0e95\u0e48\u0e2d|\u0e42\u0e17|\u0e40\u0e1a\u0e35)/iu.test(userMessage);
    const needsNotionKnowledge = !(
      isHealthServiceOverview(userMessage) ||
      /(?:\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21|\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23|\u0e15\u0e23\u0e27\u0e08|\u0e2a\u0e38\u0e02\u0e20\u0e32\u0e1e|wellness|health|\u0e42\u0e23\u0e07\u0e41\u0e23\u0e21|\u0e17\u0e35\u0e48\u0e1e\u0e31\u0e01|\u0e2b\u0e49\u0e2d\u0e07\u0e1e\u0e31\u0e01|hotel|accommodation|\u0e23\u0e16\u0e23\u0e31\u0e1a\u0e2a\u0e48\u0e07|\u0e23\u0e16|transport|transfer|shuttle|\u0e23\u0e31\u0e01\u0e29\u0e32|treatment|\u0e1a\u0e4d\u0e23\u0e34\u0e81\u0e32\u0e99|\u0eaa\u0eb8\u0e82\u0eb0\u0e9e\u0eb2\u0e9a|\u0e9e\u0eb1\u0e81\u0e8a\u0eb2|\u0e9a\u0eb1\u0e99\u0e94\u0eb2\u0e99|\u0eae\u0eb1\u0e81\u0eaa\u0eb2)/iu.test(userMessage)
    );

    const [knowledge, contactInfoBlock] = await Promise.all([
      needsNotionKnowledge
        ? searchWosNotionKnowledge(userMessage).catch((err: unknown) => {
            console.error(
              '[ai-core] Notion knowledge lookup failed',
              err instanceof Error ? err.message : String(err)
            );
            return [] as Awaited<ReturnType<typeof searchWosNotionKnowledge>>;
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof searchWosNotionKnowledge>>),
      needsContactInfo ? getContactInfoBlock() : Promise.resolve(''),
    ]);

    const knowledgeContext =
      knowledge.length > 0
        ? knowledge
            .map(
              (item) =>
                `SOURCE: ${item.source}\nTITLE: ${item.title}\nCONTENT: ${item.content}`
            )
            .join('\n\n')
        : 'NO VERIFIED KNOWLEDGE FOUND.';

    /**
     * -------------------------------------------------------
     * 2. Build AI instructions
     * -------------------------------------------------------
     */
    const cleanHistory = sanitizeHistory(history);
    if (cleanHistory.length !== history.length) {
      console.warn(
        '[WOS_AI_HISTORY_SANITIZED]',
        JSON.stringify({
          removed: history.length - cleanHistory.length,
        })
      );
    }

    const recentOptions = extractRecentConversationOptions(cleanHistory);
    const languageHistory = cleanHistory.filter((m) => m.role === 'user').map((m) => m.content);
    const lastUserLanguageAnchor = languageHistory.at(-1) ?? '';
    const lastAssistantForLanguage = [...cleanHistory].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const looksLikeNameReply = /^(?:[ก-๙\u0E80-\u0EFFA-Za-z][ก-๙\u0E80-\u0EFFA-Za-z .'-]{1,60})$/u.test(userMessage.trim())
      && /(?:ขอชื่อ|ชื่อสำหรับ|what name|name should I use|ຂໍຊື່)/iu.test(lastAssistantForLanguage);
    const customerLanguage = looksLikeNameReply
      ? detectWosLanguage(lastUserLanguageAnchor, languageHistory)
      : detectWosLanguage(userMessage, languageHistory);
    const journeyState = deriveWosJourneyState(cleanHistory, userMessage);
    // Deterministic concierge progression: once a pickup point is captured in
    // Journey State, never ask for it again. This intentionally does not use a
    // location allow-list: Laos pickup points are open-ended.
    if (journeyState.transportNeeded === true && journeyState.transportOrigin && journeyState.hotelNeeded === undefined) {
      if (customerLanguage === 'en') return 'Perfect 😊 I have the pickup point. Would you like a hotel too?';
      if (customerLanguage === 'lo') return 'ຮັບຊາບແລ້ວ 😊 ຂ້ອຍມີຈຸດຮັບແລ້ວ. ສົນໃຈໂຮງແຮມນຳບໍ?';
      return 'เรียบร้อยค่ะ 😊 ใบเฟิร์นมีจุดรับแล้วนะคะ สนใจโรงแรมด้วยไหมคะ?';
    }

    // Explicit reset commands are control messages, not new questions. Return
    // immediately so stale history cannot be echoed by the LLM before the
    // reset boundary in journey-state.ts takes effect.
    const isJourneyResetCommand = /^(?:เริ่มข้อมูลใหม่|เริ่มใหม่|เริ่มคุยใหม่|จองใหม่(?:เลย)?|ล้างข้อมูล(?:เดิม)?|เริ่มการจองใหม่|start over|start new|new booking|new journey|reset|clear previous|clear data|ລ້າງຂໍ້ມູນເກົ່າ|ລ້າງຂໍ້ມູນ|ເລີ່ມໃໝ່|ຈອງໃໝ່)$/iu.test(userMessage.trim());
    if (isJourneyResetCommand) {
      if (customerLanguage === 'lo') return 'ໄດ້ເລີຍຄ່ະ 😊 ໃບເຟີນລ້າງຂໍ້ມູນການຈອງເກົ່າໃຫ້ແລ້ວ. ເລີ່ມຂໍ້ມູນໃໝ່ໄດ້ເລີຍຄ່ະ';
      if (customerLanguage === 'en') return 'Done 😊 I cleared the previous booking information. We can start fresh.';
      return 'เรียบร้อยค่ะ 😊 ใบเฟิร์นล้างข้อมูลการจองเดิมให้แล้วนะคะ เริ่มข้อมูลใหม่ได้เลยค่ะ';
    }

    // Short conversational turns must never inherit a stale language from an
    // earlier corrupted assistant reply. The latest customer message wins.
    if (/^(?:สวัสดี|สบายดี|หวัดดี|hello|hi|hey|ສະບາຍດີ|ສະບາຍດີບໍ|ສບາຍດີ|ສບາຍດີບໍ|ສະບາຍດີແດ່)$/iu.test(userMessage.trim())) {
      if (customerLanguage === 'lo') return 'ສະບາຍດີຄ່ະ 😊 ມື້ນີ້ໃຫ້ໃບເຟີນຊ່ວຍຫຍັງດີຄະ?';
      if (customerLanguage === 'en') return 'Hi 😊 What can Fern help you with today?';
      return 'สวัสดีค่ะ 😊 วันนี้มีอะไรให้ใบเฟิร์นช่วยไหมคะ';
    }

    // New explicit facts must update the journey instead of being swallowed by
    // a previously selected program. This is the key anti-stale-context rule.
    const journeyUpdateReply = buildJourneyDataUpdateReply(userMessage, journeyState, customerLanguage);
    const isNewJourneyIntent = /(?:รถ|รถรับส่ง|รับที่|รับจาก|มารับ|โรงแรม|ที่พัก|hotel|transport|transfer|shuttle|นวด|สปา|spa|massage|ตรวจสุขภาพ|สุขภาพ|wellness)/iu.test(userMessage);
    const isConversationProgressMessage = /(?:ทำไงต่อ|ทำอะไรต่อ|ต้องการอะไรอีก|ต้องทำอะไรต่อ|ผมแจ้งไปแล้ว|แจ้งไปแล้ว|แล้วไงต่อ|ต้องทำอะไรเพิ่ม|what(?:'s| is) next|next step|i already told you)/iu.test(userMessage);
    // Never answer a progress/update message with the old generic
    // "I've updated your details" loop. The webhook owns the final
    // concierge transition; AI Core should continue to the next real intent.
    if (journeyUpdateReply && !isNewJourneyIntent && !isConversationProgressMessage) return journeyUpdateReply;

    // A selected health program enters a deterministic booking mini-flow.
    // Never hand this turn to the LLM, because the model may revive the old
    // generic booking form. Capture only the next missing core fact.
    const isHotelAvailabilityIntent =
      /(?:โรงแรม|ที่พัก|ห้องพัก|hotel|room|accommodation|ຮ້ານແຮມ|ໂຮງແຮມ|ຫ້ອງພັກ).*?(?:ว่าง|มีห้อง|availability|available|ເຫຼືອ|ວ່າງ)|(?:เช็คอิน|เช็กอิน|check[- ]?in|เข้าพัก|checkout|check[- ]?out).*?(?:โรงแรม|ที่พัก|ห้อง|hotel|room|ໂຮງແຮມ|ຫ້ອງ)/iu.test(userMessage);

    if (journeyState.selectedProgram && !journeyState.customerName && !isHotelAvailabilityIntent) {
      if (customerLanguage === 'lo') return 'ຂໍຊື່ສຳລັບການປະສານງານແດ່ຄ່ະ 😊';
      if (customerLanguage === 'en') return 'Perfect 😊 What name should I use for the booking?';
      return 'ได้เลยค่ะ 😊 ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ';
    }

    // The selected-program concierge is state-driven. Once the program and
    // customer name are known, never fall back to catalog/model selection:
    // move through transport -> pickup -> hotel -> handoff exactly once.
    if (journeyState.selectedProgram && journeyState.customerName) {
      const conciergeStage = getWosConciergeStage(journeyState);
      if (conciergeStage === 'ask_transport_interest') {
        if (customerLanguage === 'lo') return 'ຮັບຊາບຄ່ະ 😊 ສົນໃຈລົດຮັບສົ່ງນຳບໍຄ່ະ?';
        if (customerLanguage === 'en') return 'Got it 😊 Would you like transport as well?';
        return 'รับทราบค่ะ 😊 สนใจรถรับส่งด้วยไหมคะ?';
      }
      if (conciergeStage === 'collecting_transport') {
        if (customerLanguage === 'lo') return 'ໄດ້ຄ່ະ 😊 ຂໍຈຸດຮັບດ້ວຍນະຄະ ທີມ WOS ຈະປະສານລາຍລະອຽດລົດສ່ວນທີ່ເຫຼືອຕໍ່ໃຫ້ຄ່ະ';
        if (customerLanguage === 'en') return 'Sure 😊 What is the pickup point? The WOS team will coordinate the remaining transport details with you.';
        return 'ได้เลยค่ะ 😊 ขอจุดรับด้วยนะคะ เดี๋ยวทีม WOS จะประสานรายละเอียดรถส่วนที่เหลือต่อให้ค่ะ';
      }
      if (conciergeStage === 'ask_hotel_interest') {
        if (customerLanguage === 'lo') return 'ຮັບຊາບແລ້ວ 😊 ໃບເຟີນມີຈຸດຮັບແລ້ວ. ສົນໃຈໂຮງແຮມນຳບໍຄ່ະ?';
        if (customerLanguage === 'en') return 'Perfect 😊 I have the pickup point. Would you like a hotel too?';
        return 'เรียบร้อยค่ะ 😊 ใบเฟิร์นมีจุดรับแล้วนะคะ สนใจโรงแรมด้วยไหมคะ?';
      }
      if (conciergeStage === 'awaiting_confirmation' && journeyState.hotelNeeded === true) {
        if (customerLanguage === 'lo') return 'ຮັບຊາບຄ່ະ 😊 ໃບເຟີນຮັບເລື່ອງໂຮງແຮມໄວ້ແລ້ວ ທີມ WOS ຈະປະສານຕໍ່ໃຫ້ຄ່ະ';
        if (customerLanguage === 'en') return 'Got it 😊 I have noted the hotel request. The WOS team will coordinate the hotel details with you.';
        return 'รับทราบค่ะ 😊 ใบเฟิร์นรับเรื่องโรงแรมไว้แล้วนะคะ เดี๋ยวทีม WOS จะประสานรายละเอียดต่อให้ค่ะ';
      }
      if (conciergeStage === 'awaiting_confirmation' && journeyState.hotelNeeded === false) {
        return buildHandoffConfirmation(customerLanguage);
      }
    }

    // An active concierge journey owns ambiguous short replies (for example
    // a bare province such as "อุดร"). Do not let catalog lookup steal the
    // turn while Fern is still collecting the minimum handoff data.
    const hasActiveConciergeState = Boolean(
      journeyState.selectedProgram ||
      journeyState.transportNeeded !== undefined ||
      journeyState.transportOrigin ||
      journeyState.hotelNeeded !== undefined
    );
    const isExplicitProgramLookup = isProgramOverviewQuestion(userMessage) || Boolean(getSymptomSearchAliases(userMessage)[0]);
    if (hasActiveConciergeState && !isExplicitProgramLookup && !isHotelAvailabilityIntent && !isNewJourneyIntent) {
      if (!journeyState.customerName) {
        if (customerLanguage === 'lo') return 'ຂໍຊື່ສຳລັບລົງຂໍ້ມູນໃຫ້ທີມ WOS ປະສານງານຕໍ່ແດ່ຄ່ະ 😊';
        if (customerLanguage === 'en') return 'Sure 😊 What name should I use for the WOS team to coordinate with you?';
        return 'ได้เลยค่ะ 😊 ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ';
      }
    }

    // Program-overview requests are explicit topic switches. Resolve them
    // before journey planning so a stale hotel/transport/program state cannot
    // swallow a fresh "what programs are available?" question.
    // Never dump unrelated hotel/transport inventory just because those records
    // also live in the catalog. Those are concierge capabilities that Fern
    // should offer later, when the journey calls for them.
    if (isProgramOverviewQuestion(userMessage)) {
      try {
        const province = detectLocationFromRawText(userMessage)[0] ?? undefined;
        if (!province) {
          const provinces = await getCatalogProvinces();
          if (customerLanguage === 'lo') {
            const laoProvinceNames: Record<string, string> = {
              'หนองคาย': 'ໜອງຄາຍ',
              'อุดรธานี': 'ອຸດອນທານີ',
              'ขอนแก่น': 'ຂອນແກ່ນ',
              'กรุงเทพมหานคร': 'ກຸງເທບ',
            };
            const laoProvinces = provinces.map((province) => laoProvinceNames[province] ?? province);
            return laoProvinces.length
              ? `ຕອນນີ້ WOS ມີໂປຣແກຣມສຸຂະພາບໃນ ${laoProvinces.join(', ')} ຄ່ະ ໃບເຟີນຂໍຮູ້ກ່ອນວ່າສົນໃຈຈັງຫວັດໃດຄ່ະ?`
              : 'ສົນໃຈໂປຣແກຣມທີ່ຈັງຫວັດໃດຄ່ະ?';
          }
          if (customerLanguage === 'en') {
            return provinces.length
              ? `WOS currently has health programs in ${provinces.join(', ')}. Which province are you interested in?`
              : 'Which province are you interested in?';
          }
          return provinces.length
            ? `ตอนนี้ WOS มีโปรแกรมสุขภาพใน ${provinces.join(', ')} ค่ะ สนใจโปรแกรมที่จังหวัดไหนคะ?`
            : 'สนใจโปรแกรมที่จังหวัดไหนคะ?';
        }
        const items = await searchHealthProgramOverview(5, province);
        if (items.length > 0) {
          const answer = buildProgramAnswer(items, userMessage, languageHistory.join('\\n'), customerLanguage);
          if (answer) return answer;
        }
      } catch (programOverviewError) {
        console.warn(
          '[WOS_AI_PROGRAM_OVERVIEW_LOOKUP_FAILED]',
          programOverviewError instanceof Error ? programOverviewError.message : String(programOverviewError)
        );
      }
    }

    // A province-only reply is a deterministic continuation of the catalog
    // question above. Never send a bare province through the LLM: it can be
    // misread as an incomplete fragment and produce unrelated language.
    const requestedProvince = detectLocationFromRawText(userMessage)[0];
    const previousAssistantAskedProvince = [...cleanHistory]
      .reverse()
      .find((m) => m.role === 'assistant' && /(?:จังหวัดไหน|which province|ຈັງຫວັດໃດ)/iu.test(m.content));
    if (requestedProvince && previousAssistantAskedProvince) {
      try {
        const items = await searchHealthProgramOverview(5, requestedProvince);
        const answer = buildProgramAnswer(items, requestedProvince, languageHistory.join('\\n'), customerLanguage);
        if (answer) return answer;
        if (customerLanguage === 'lo') return `ຕອນນີ້ຍັງບໍ່ພົບໂປຣແກຣມສຸຂະພາບທີ່ຢືນຢັນແລ້ວໃນ ${requestedProvince} ຄ່ະ`;
        if (customerLanguage === 'en') return `I couldn't find a verified WOS health program in ${requestedProvince} right now.`;
        return `ตอนนี้ยังไม่พบโปรแกรมสุขภาพที่ยืนยันแล้วใน${requestedProvince}ค่ะ`;
      } catch (provinceLookupError) {
        console.warn('[WOS_AI_PROVINCE_LOOKUP_FAILED]', provinceLookupError instanceof Error ? provinceLookupError.message : String(provinceLookupError));
      }
    }

    // Explicit language-switch commands must never fall through to the model.
    // They are control messages, not questions for generation.
    if (/^(?:ภาษาไทย|ไทย|พูดไทย|ขอภาษาไทย)$/iu.test(userMessage.trim())) {
      return 'ได้เลยค่ะ 😊 ต่อจากนี้ใบเฟิร์นจะตอบเป็นภาษาไทยนะคะ สนใจโปรแกรมที่จังหวัดไหนคะ?';
    }

    // Symptom/topic switches must reach the verified catalog before journey
    // planning. This is especially important when the customer already has a
    // journey state: a symptom is a new service intent, not a trip-planning
    // field to collect.
    const earlySymptomAlias = getSymptomSearchAliases(userMessage)[0];
    if (earlySymptomAlias) {
      try {
        const province = detectLocationFromRawText(userMessage)[0] ?? '';
        const symptomQuery = [earlySymptomAlias, province].filter(Boolean).join(' ');
        const items = await searchPrograms(symptomQuery, 5);
        if (items.length > 0) {
          const answer = buildProgramAnswer(items, userMessage, '', customerLanguage);
          if (answer) return answer;
        }
      } catch (symptomLookupError) {
        console.warn('[WOS_AI_EARLY_SYMPTOM_LOOKUP_FAILED]', symptomLookupError instanceof Error ? symptomLookupError.message : String(symptomLookupError));
      }
    }

    // Only after explicit catalog requests are resolved should structured
    // journey planning get a chance to answer the message.
    const journeyPlanningReply = buildJourneyPlanningReply(userMessage, journeyState, customerLanguage);
    if (journeyPlanningReply) return journeyPlanningReply;

    // A symptom/topic switch must re-route to the verified catalog before any
    // treatment handoff or previously selected program can answer it.
    const symptomAlias = getSymptomSearchAliases(userMessage)[0];
    if (symptomAlias) {
      try {
        const province = detectLocationFromRawText(userMessage)[0] ?? journeyState.destination ?? '';
        const symptomQuery = [symptomAlias, province].filter(Boolean).join(' ');
        const items = await searchPrograms(symptomQuery, 5);
        if (items.length > 0) {
          const answer = buildProgramAnswer(items, userMessage, '', customerLanguage);
          if (answer) return answer;
        }
      } catch (symptomLookupError) {
        console.warn('[WOS_AI_SYMPTOM_LOOKUP_FAILED]', symptomLookupError instanceof Error ? symptomLookupError.message : String(symptomLookupError));
      }
    }

    // Journey-intent guards run before catalog/model processing. A selected
    // health program must never swallow a new transport/hotel request.
    // For transport, turn already-captured facts into a short checklist so
    // the customer only gets asked for fields that are still missing.
    const buildTransportChecklist = (): string => {
      // V1 intentionally collects only transport interest + pickup point.
      // Do not ask for drop-off/destination; WOS Admin coordinates the
      // remaining transport details after handoff.
      if (journeyState.transportOrigin) {
        return customerLanguage === 'en'
          ? 'Got it 😊 I have the pickup point. Would you like a hotel too?'
          : customerLanguage === 'lo'
            ? 'ຮັບຊາບແລ້ວ 😊 ຂ້ອຍມີຈຸດຮັບແລ້ວ. ສົນໃຈໂຮງແຮມນຳບໍ?'
            : 'เรียบร้อยค่ะ 😊 ใบเฟิร์นมีจุดรับแล้วนะคะ สนใจโรงแรมด้วยไหมคะ?';
      }
      return customerLanguage === 'en'
        ? 'Sure 😊 What is the pickup point?'
        : customerLanguage === 'lo'
          ? 'ໄດ້ເລີຍ 😊 ຈຸດຮັບຢູ່ໃສຄະ?'
          : 'ได้เลยค่ะ 😊 ขอจุดรับด้วยนะคะ เดี๋ยวทีม WOS จะประสานรายละเอียดรถส่วนที่เหลือต่อให้ค่ะ';
    };
    const asksTransportEarly = /รถ|รถรับส่ง|รถรับ|รับส่ง|transport|transfer|shuttle|ລົດ|ລົດຮັບສົ່ງ|ຮັບສົ່ງ/iu.test(userMessage);
    if (asksTransportEarly) {
      return buildTransportChecklist();
    }

    const asksHotelEarly = isHotelRequirementQuestion(userMessage);
    const hasHotelDateEarly = /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(userMessage);
    if (asksHotelEarly && !hasHotelDateEarly) {
      if (journeyState.hotelNeeded === true) {
        if (customerLanguage === 'lo') return 'ຮັບຊາບຄ່ະ 😊 ໃບເຟີນຮັບເລື່ອງໂຮງແຮມໄວ້ແລ້ວ ທີມ WOS ຈະປະສານຕໍ່ໃຫ້ຄ່ະ';
        if (customerLanguage === 'en') return 'Got it 😊 I have noted the hotel request. The WOS team will coordinate the hotel details with you.';
        return 'รับทราบค่ะ 😊 ใบเฟิร์นรับเรื่องโรงแรมไว้แล้วนะคะ เดี๋ยวทีม WOS จะประสานรายละเอียดต่อให้ค่ะ';
      }
      if (customerLanguage === 'lo') {
        return 'ໄດ້ຄ່ະ 😊 ສົນໃຈໂຮງແຮມບໍຄ່ະ? ໃບເຟີນຈະຮັບເລື່ອງໄວ້ໃຫ້ທີມ WOS ປະສານຕໍ່ຄ່ະ';
      }
      if (customerLanguage === 'en') {
        return 'Sure 😊 Just let me know if you would like a hotel too, and I will pass the request to the WOS team.';
      }
      return 'ได้ค่ะ 😊 สนใจโรงแรมด้วยไหมคะ? ถ้าต้องการ ใบเฟิร์นจะรับเรื่องไว้ให้ทีม WOS ประสานต่อค่ะ';
    }

    // Broad health-service questions must always hit the verified catalog.
    // This prevents a local model from turning an available health program
    // into a false "no verified information" answer after a topic change.
    if (isHealthServiceOverview(userMessage) || /(?:\u0e21\u0e35\u0e42\u0e04\u0e07\u0e01\u0e32\u0e23|\u0e42\u0e04\u0e07\u0e01\u0e32\u0e23\u0e43\u0e14|\u0e21\u0e35\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23|\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23\u0e43\u0e14|\u0e2a\u0e38\u0e02\u0e30\u0e20\u0e32\u0e1e|\u0e01\u0e27\u0e14\u0e2b\u0e31\u0e27\u0e40\u0e02\u0e48\u0e32)/iu.test(userMessage)) {
      try {
        const province = detectLocationFromRawText(userMessage)[0] ?? '';
        const items = await searchHealthProgramOverview(5, province || undefined);
        if (items.length > 0) {
          const answer = buildProgramAnswer(items, userMessage, languageHistory.join('\\n'), customerLanguage);
          if (answer) return answer;
        }
      } catch (healthLookupError) {
        console.warn('[WOS_AI_HEALTH_OVERVIEW_LOOKUP_FAILED]', healthLookupError instanceof Error ? healthLookupError.message : String(healthLookupError));
      }
    }

    // Trip-planning is intentionally a concierge handoff, not an invented
    // itinerary. We can collect the minimum planning inputs now and later
    // replace this with verified transport/hotel/restaurant/attraction
    // matching as the WOS partner network grows.
    const tripPlanningReply = buildTripPlanningReply(userMessage, journeyState, customerLanguage);
    if (tripPlanningReply) return tripPlanningReply;

    const dictionaryHints = await getLanguageDictionaryHints(userMessage, customerLanguage);

    const currentSelection = parseProgramSelection(userMessage, recentOptions);
    const selectedOption = resolveProgramSelection(
      userMessage,
      cleanHistory,
      recentOptions
    );

    // A numeric/indexed selection is deterministic conversation state. Resolve
    // it directly against the live catalog so a small model cannot turn "1"
    // back into a broad search or ask the customer to confirm the selection.
    if (currentSelection) {
      try {
        const selectedPrograms = await searchPrograms(currentSelection.label, 3);
        const matched = selectedPrograms.find((program) => {
          const title = String(program.title ?? '').trim();
          return title === currentSelection.label ||
            title.includes(currentSelection.label) ||
            currentSelection.label.includes(title);
        });
        if (matched) {
          const selectedAnswer = buildProgramAnswer(
            [matched],
            userMessage,
            languageHistory.join('\n'),
            customerLanguage
          );
          if (selectedAnswer) return selectedAnswer;
        }
      } catch (selectionError) {
        console.warn(
          '[WOS_AI_SELECTION_LOOKUP_FAILED]',
          selectionError instanceof Error ? selectionError.message : String(selectionError)
        );
      }
    }

    // A customer saying "สนใจต้องทำไง" after a multi-item list is not a
    // request to search the catalog again. It is an unresolved selection.
    // Resolve this deterministically so the model cannot silently choose the
    // first result.
    if (
      !selectedOption &&
      isAmbiguousProgramFollowUp(userMessage, recentOptions)
    ) {
      const labels = recentOptions
        .map((option) => `${option.index}. ${option.label}`)
        .join(customerLanguage === 'lo' ? ' ຫຼື ' : ' หรือ ');
      if (customerLanguage === 'lo') {
        return `ໄດ້ເລີຍ 😊 ສົນໃຈໂປຣແກຣມໃດຄະ? ຕອນນີ້ມີ ${labels} ບອກໝາຍເລກໃຫ້ໃບເຟີນໄດ້ເລີຍ ແລ້ວຈະຊ່ວຍພາໄປຕໍ່ໃຫ້ຄ່ະ`;
      }
      if (customerLanguage === 'en') {
        return `Sure 😊 Which program are you interested in? We currently have ${labels}. Tell me the number and I’ll help you continue.`;
      }
      return `ได้เลยค่ะ 😊 สนใจตัวไหนคะ? ตอนนี้มี ${labels} ถ้าบอกหมายเลขให้ใบเฟิร์นได้เลย เดี๋ยวช่วยพาไปต่อให้ค่ะ`;
    }

    // Treatment questions are a journey/consultation intent, not a
    // request to repeat whichever catalog item happened to be selected
    // earlier. Keep the conversation moving toward WOS coordination.
    if (isTreatmentJourneyQuestion(userMessage)) {
      if (customerLanguage === 'lo') {
        return 'ໄດ້ເລີຍຄ່ະ 😊 ຖ້າຕ້ອງການມາຮັກສາຢູ່ໄທ WOS ຊ່ວຍປະສານໃຫ້ໄດ້ຄ່ະ. ຂໍຮູ້ອາການ ຫຼື ສາຂາທີ່ຕ້ອງການພົບໝໍ, ຈາກນັ້ນທີມ WOS ຈະຊ່ວຍກວດຫາສະຖານພະຍາບານ ແລະ ນັດໝາຍຕາມຂໍ້ມູນທີ່ຢືນຢັນໄດ້ຄ່ະ';
      }
      if (customerLanguage === 'en') {
        return 'Absolutely 😊 If you want treatment in Thailand, WOS can help coordinate the next steps. Tell me your symptoms or the medical specialty you want to see, and the WOS team can check suitable verified providers and appointment options. Fern won’t diagnose or promise a treatment outcome.';
      }
      return 'ได้เลยค่ะ 😊 ถ้าต้องการมารักษาที่ไทย WOS ช่วยประสานขั้นตอนให้ได้ค่ะ บอกอาการหรือสาขาที่อยากพบแพทย์ก่อนก็ได้ เดี๋ยวทีม WOS ช่วยตรวจสอบสถานพยาบาลและคิวนัดจากข้อมูลที่ยืนยันได้ให้ค่ะ ใบเฟิร์นจะไม่วินิจฉัยโรคหรือรับรองผลการรักษานะคะ';
    }

    // A selected program + "ขั้นตอนยังไง/จองยังไง" should explain the
    // journey instead of repeating the program card.
    if (selectedOption && isBookingProcessQuestion(userMessage)) {
      if (customerLanguage === 'lo') {
        return 'ໄດ້ຄ່ະ 😊 ສຳລັບ "' + selectedOption.label + '" ຂັ້ນຕອນໂດຍຫຍໍ້ຄື: 1) ແຈ້ງວັນ-ເວລາທີ່ຕ້ອງການ 2) ແຈ້ງຊື່-ນາມສະກຸນ ແລະ ເບີໂທ 3) WOS ກວດຄິວ/ລາຄາປັດຈຸບັນ 4) ຮັບລາຍລະອຽດການຈອງ/ໃບສະເໜີ 5) ຊຳລະມັດຈຳຕາມຂໍ້ມູນທີ່ WOS ຢືນຢັນ 6) ສົ່ງສະລິບ ແລະ ລໍຖ້າ WOS ຢືນຢັນການນັດ. ການຈອງຈະຖືວ່າສຳເລັດເມື່ອ WOS ຢືນຢັນແລ້ວຄ່ະ';
      }
      if (customerLanguage === 'en') {
        return 'Sure 😊 For "' + selectedOption.label + '", the usual WOS flow is: 1) share your preferred date/time, 2) provide your full name and phone number, 3) WOS checks the current queue/price, 4) review the booking/quote details, 5) pay the required deposit using WOS instructions, and 6) upload the payment slip and wait for WOS confirmation. It is only considered booked after WOS confirms it.';
      }
      return 'ได้เลยค่ะ 😊 สำหรับ "' + selectedOption.label + '" ขั้นตอนโดยสรุปคือ 1) แจ้งวันและเวลาที่ต้องการ 2) ชื่อ-นามสกุลและเบอร์โทร 3) WOS ตรวจสอบคิวและข้อมูลปัจจุบัน 4) ดูรายละเอียดการจอง/ใบเสนอราคา 5) ชำระมัดจำตามข้อมูลที่ WOS ยืนยัน 6) ส่งสลิป แล้วรอ WOS ยืนยันนัดค่ะ การจองจะถือว่าสำเร็จเมื่อ WOS ยืนยันแล้วนะคะ';
    }

    // Price is operational data, so a selected-program price question
    // can be answered directly from the live catalog without depending on
    // another LLM round. This also preserves the active selection when the
    // LLM gateway is temporarily unavailable.
    const asksPrice = selectedOption && /ราคา|ค่าใช้จ่าย|กี่บาท|โปรโมชั่น|โปรโมชัน|ລາຄາ|ຄ່າໃຊ້ຈ່າຍ|ກີ່ກີບ|ກີ່ບາດ|ໂປຣໂມຊັນ|ໂປຣໂມຊັນພິເສດ|price|cost|how much|promotion/iu.test(userMessage);
    if (asksPrice) {
      try {
        const selectedPrograms = await searchPrograms(selectedOption.label, 1);
        const selectedAnswer = buildProgramPriceAnswer(
          selectedPrograms[0],
          userMessage,
          languageHistory.join('\n'),
          customerLanguage
        );
        if (selectedAnswer) return selectedAnswer;
      } catch (priceError) {
        console.warn(
          '[WOS_AI_SELECTED_PRICE_LOOKUP_FAILED]',
          priceError instanceof Error ? priceError.message : String(priceError)
        );
      }
    }

    // A customer may explicitly point out that Fern is repeating herself.
    // Do not send that meta-conversation through the LLM: the old assistant
    // reply is part of history and a small local model can simply imitate it.
    // Reset the conversation naturally, then let the next real request drive
    // the catalog/tool flow again.
    const asksWhyRepeating =
      /(?:ทำไม|เพราะอะไร).*?(?:ตอบซ้ำ|ซ้ำๆ|พูดซ้ำ|ตอบเหมือนเดิม)|(?:ตอบซ้ำ|ซ้ำๆ|พูดซ้ำ).*?(?:ทำไม|อีกแล้ว)|why.*(?:repeat|same answer)|you keep repeating/iu.test(
        userMessage
      );

    if (asksWhyRepeating) {
      if (customerLanguage === 'lo') {
        return 'ຈິງດ້ວຍຄ່ະ ເມື່ອກີ້ໃບເຟີນຕອບຊ້ຳເກີນໄປ. ຂໍເລີ່ມໃໝ່ຈາກຄຳຖາມຂອງລູກຄ້າເລີຍຄ່ະ';
      }
      if (customerLanguage === 'en') {
        return 'You are right — I repeated myself. Let me reset and answer from your actual question instead.';
      }
      return 'จริงด้วยค่ะ เมื่อกี้ใบเฟิร์นตอบซ้ำเกินไป ขอโทษนะคะ เดี๋ยวใบเฟิร์นเริ่มใหม่และตอบจากคำถามจริงของคุณเลยค่ะ';
    }

    // Transport is a WOS journey capability, not necessarily a package
    // returned by the program catalog. Answer the basic "มีรถรับส่งไหม?"
    // question from approved WOS knowledge, then collect the minimum details
    // needed before any real availability/price claim.
    const asksTransport =
      /รถรับส่ง|รถรับ|รับส่ง|transport|transfer|shuttle|ລົດຮັບສົ່ງ|ຮັບສົ່ງ/iu.test(
        userMessage
      );

    if (asksTransport) {
      if (customerLanguage === 'lo') {
        return journeyState.transportOrigin
          ? 'ຮັບຊາບຄ່ະ 😊 ໃບເຟີນຮັບຈຸດຮັບໄວ້ແລ້ວ ສົນໃຈໂຮງແຮມເພີ່ມບໍຄ່ະ?'
          : 'ໄດ້ເລີຍຄ່ະ 😊 ຂໍຈຸດຮັບດ້ວຍນະຄະ ທີມ WOS ຈະປະສານລາຍລະອຽດລົດຮັບສົ່ງຕໍ່ໃຫ້ຄ່ະ';
      }
      if (customerLanguage === 'en') {
        return journeyState.transportOrigin
          ? 'Perfect 😊 I have the pickup point. Would you like a hotel too?'
          : 'Sure 😊 What is the pickup point? WOS Admin will coordinate the remaining transport details with you.';
      }
      return journeyState.transportOrigin
        ? 'เรียบร้อยค่ะ 😊 ใบเฟิร์นรับจุดรับไว้แล้วนะคะ สนใจโรงแรมด้วยไหมคะ?'
        : 'ได้เลยค่ะ 😊 ขอจุดรับด้วยนะคะ เดี๋ยวทีม WOS จะประสานรายละเอียดรถรับส่งต่อให้ค่ะ';
    }

    // Hotels follow the same first-phase concierge pattern: collect the
    // requirement first and let WOS Admin confirm live availability/final
    // pricing. Only run the availability tool when exact dates are supplied.
    if (isHotelRequirementQuestion(userMessage) && !/\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(userMessage)) {
      if (journeyState.hotelNeeded === true) {
        if (customerLanguage === 'lo') return 'ຮັບຊາບຄ່ະ 😊 ໃບເຟີນຮັບເລື່ອງໂຮງແຮມໄວ້ແລ້ວ ທີມ WOS ຈະປະສານຕໍ່ໃຫ້ຄ່ະ';
        if (customerLanguage === 'en') return 'Got it 😊 I have noted the hotel request. The WOS team will coordinate the hotel details with you.';
        return 'รับทราบค่ะ 😊 ใบเฟิร์นรับเรื่องโรงแรมไว้แล้วนะคะ เดี๋ยวทีม WOS จะประสานรายละเอียดต่อให้ค่ะ';
      }
      if (customerLanguage === 'lo') {
        return 'ສົນໃຈໂຮງແຮມເພີ່ມບໍຄ່ະ? ຖ້າຕ້ອງການ ໃບເຟີນຈະຮັບເລື່ອງໄວ້ໃຫ້ທີມ WOS ປະສານຕໍ່ຄ່ະ';
      }
      if (customerLanguage === 'en') {
        return 'Sure 😊 Just let me know if you would like a hotel too, and I will pass the request to the WOS team.';
      }
      return 'สนใจโรงแรมด้วยไหมคะ? ถ้าต้องการ ใบเฟิร์นจะรับเรื่องไว้ให้ทีม WOS ประสานต่อค่ะ';
    }

    // A booking request is a journey step, not a reason to refuse the
    // customer. WOS is the booking point, so when a program has already
    // been selected, answer this deterministically instead of letting the
    // local model turn the lack of a booking-write tool into a generic
    // "I cannot book" refusal.
    const asksToBook =
      /(?:จอง|นัด|จองให้|ขอจอง|ต้องการจอง|book|booking|reserve|reservation|ຈອງ|ນັດ)/iu.test(
        userMessage
      );

    if (asksToBook && !selectedOption) {
      // If the customer names the program in the booking request itself,
      // resolve it from the live catalog instead of making the model guess
      // whether the booking target is the first item in old conversation
      // history. If several programs match, ask which one; never pick one.
      try {
        const bookingMatches = await searchPrograms(userMessage, 3);
        if (bookingMatches.length === 1) {
          const label = bookingMatches[0].title ?? 'โปรแกรมที่เลือก';
          if (customerLanguage === 'lo') {
            return 'ໄດ້ເລີຍຄ່ະ ສຳລັບ "' + label + '" ສາມາດຈອງຜ່ານ WOS ໄດ້. ໃບເຟີນຊ່ວຍພາໄປຕໍ່ຕາມຂັ້ນຕອນຈອງຄ່ະ';
          }
          if (customerLanguage === 'en') {
            return 'Absolutely. For "' + label + '", booking is handled through WOS. I can help you continue with the booking steps.';
          }
          return 'ได้เลยค่ะ สำหรับ "' + label + '" จองผ่าน WOS ได้เลยนะคะ ใบเฟิร์นช่วยพาไปต่อในขั้นตอนจองให้ค่ะ';
        }

        if (bookingMatches.length > 1) {
          const labels = bookingMatches
            .map((item, index) => `${index + 1}. ${item.title}`)
            .join('\n');
          if (customerLanguage === 'en') {
            return 'Sure. Before booking, please choose which program you want:\n' + labels;
          }
          return 'ได้เลยค่ะ ก่อนจองขอให้เลือกโปรแกรมก่อนนะคะ:\n' + labels;
        }
      } catch (bookingError) {
        console.warn(
          '[WOS_AI_BOOKING_LOOKUP_FAILED]',
          bookingError instanceof Error ? bookingError.message : String(bookingError)
        );
      }
    }

    if (selectedOption && asksToBook) {
      if (customerLanguage === 'lo') {
        return 'ໄດ້ເລີຍຄ່ະ 😊 ສຳລັບ "' + selectedOption.label + '" ໃບເຟີນຈະຊ່ວຍພາເຂົ້າສູ່ຂັ້ນຕອນຈອງຜ່ານ WOS. ກ່ອນຈອງ ຂໍວັນ-ເວລາທີ່ຕ້ອງການ, ຊື່-ນາມສະກຸນ ແລະເບີໂທ ຖ້າຍັງບໍ່ໄດ້ແຈ້ງຄ່ະ';
      }
      if (customerLanguage === 'en') {
        return 'Absolutely. For "' + selectedOption.label + '", booking is handled through WOS. To continue, please share your preferred service date/time, full name, and phone number if you have not already provided them. I will not treat it as booked until WOS confirms the booking.';
      }
      return 'ได้เลยค่ะ สำหรับ "' + selectedOption.label + '" ใบเฟิร์นพาเข้าสู่ขั้นตอนจองผ่าน WOS ให้ค่ะ ขอวันและเวลาที่ต้องการรับบริการ ชื่อ-นามสกุล และเบอร์โทร ถ้ายังไม่ได้แจ้งข้อมูลไว้ก่อนนะคะ เมื่อ WOS ยืนยันแล้วจึงถือว่าจองสำเร็จค่ะ';
    }

    // "ต้องติดต่อใคร" during a selected-program journey is a booking-flow
    // question, not a request for a phone number. Keep the customer inside
    // WOS rather than routing them directly to the partner.
    const asksWhoToContact =
      selectedOption &&
      /(?:ต้อง)?\s*ติดต่อใคร|ติดต่อ.*ใคร|ຕ້ອງຕິດຕໍ່ໃຜ|ຈະຕິດຕໍ່ໃຜ|who.*contact/iu.test(userMessage) &&
      !/(?:เบอร์|โทร|โทรศัพท์|line|ไลน์|whatsapp|วอทส์แอป|อีเมล|email|ເບີ|ໂທ|ວອດສແອັບ|ອີເມວ)/iu.test(
        userMessage
      );

    if (asksWhoToContact) {
      if (customerLanguage === 'lo') {
        return 'ຖ້າຈະຈອງໂປຣແກຣມ "' + selectedOption.label + '" ບໍ່ຈຳເປັນຕ້ອງຕິດຕໍ່ພາຣທ໌ເນີໂດຍກົງຄ່ະ 😊 ສາມາດຈອງຜ່ານ WOS ໄດ້ເລີຍ. ຖ້າຈອງເອງບໍ່ສະດວກ ບອກໃບເຟີນໄດ້ ແລ້ວຈະຊ່ວຍປະສານທີມ WOS ໃຫ້ຄ່ະ';
      }
      if (customerLanguage === 'en') {
        return 'To book "' + selectedOption.label + '", you do not need to contact the partner directly. You can book through WOS. If you need help completing the booking, I can help connect you with the WOS team.';
      }
      return `ถ้าจะจองโปรแกรม "${selectedOption.label}" ไม่ต้องติดต่อพาร์ทเนอร์โดยตรงนะคะ 😊 จองผ่าน WOS ได้เลยค่ะ ถ้าทำขั้นตอนจองเองไม่สะดวก บอกใบเฟิร์นได้ เดี๋ยวช่วยประสานทีม WOS ให้ค่ะ`;
    }

    const structuredJourneyState = formatJourneyState(journeyState, customerLanguage);
    const conversationState = recentOptions.length > 0
      ? `CONVERSATION STATE (derived from recent verified conversation text):
- Recent program options: ${recentOptions.map((option) => `${option.index} = ${option.label}`).join('; ')}
- Selected option this turn: ${selectedOption?.label ?? 'none'}
- If the customer selected an option, keep that program as the active subject. Do not switch to another program unless the customer explicitly changes it.
- If no option is selected and the customer asks a generic follow-up, ask one concise clarification instead of choosing a program.
`
      : `CONVERSATION STATE:
- No indexed program selection is available from recent conversation text.
- Do not invent a selected program. Ask a concise clarification when the customer's request is ambiguous.
`;

    const languageInstructions =
      'CURRENT CUSTOMER LANGUAGE: ' + languageName(customerLanguage) + '\n' +
      '- Reply in the current customer language unless the customer explicitly asks to switch.\n' +
      '- Lao customer messages must receive natural Lao, not Thai and not word-for-word machine translation.\n' +
      '- Thai customer messages must receive natural Thai.\n' +
      '- English customer messages must receive natural English.\n' +
      '- Short replies such as "1", "2", or a short follow-up inherit the conversation language from recent turns.\n' +
      '- If the customer switches language explicitly, follow the new language while preserving program and journey context.\n' +
      '- The dictionary is a lexical reference only. It never overrides verified WOS facts and must not invent business data.\n' +
      'DICTIONARY REFERENCE:\n' + dictionaryHints;

    const instructions = `${WOS_AI_SYSTEM_PROMPT}\n\n${languageInstructions}

KNOWLEDGE RETRIEVAL RULES:
- Use the verified WOS knowledge below whenever it is relevant.
- Do not invent information that is not supported by verified knowledge or live tool results.
- If the knowledge does not contain the requested information, do not guess.
- Clearly distinguish between verified WOS information and information that is unavailable.
- Never treat missing knowledge as permission to invent an answer.

LIVE PROGRAM TOOL RULES:
- Use searchPrograms when the customer asks about available WOS programs, packages, services, treatments, wellness services, clinics, hotels, transport, or wants help finding a suitable program.
- Search results represent currently published and active WOS programs.
- Use getProgramDetails when the customer asks for detailed information about a specific program found through searchPrograms.
- Only use getProgramDetails with a program ID returned by searchPrograms.
- Never invent a program ID.
- Never invent a program, partner, price, service, availability, schedule, duration, or benefit.
- Always call searchPrograms with short THAI keywords, because program data is stored in Thai. Translate the customer's request into Thai first, even if the customer writes in English or Lao.
- If searchPrograms returns no results, retry once with a broader Thai keyword (for example "เข่า" instead of "ตรวจเข่า") before concluding anything.
- If the retry also returns no results, clearly say that no matching published WOS program was found.
- If getProgramDetails returns no result, clearly say that verified details for that program are not currently available.
- Do not claim that a program is available for a specific date or time unless a dedicated availability tool confirms it.
- Do not expose partner commercial terms, commission rates, internal IDs, admin data, security information, or other internal WOS operational information.
- Internal program IDs may be used by tools but must not be shown to customers.
- When the customer asks a broad question, search first rather than guessing.
- When CONVERSATION STATE identifies a selected indexed option, search for that exact program label (not a generic category) and keep that program as the active subject.
- When the customer asks about a specific program and the search result identifies it, retrieve the details before answering when useful.
- Answer in the customer's language whenever practical.
- If the latest customer message is short or numeric, use the recent conversation state to interpret it; do not infer a new language or topic from the short message alone.

VERIFIED WOS KNOWLEDGE:
${knowledgeContext}

${contactInfoBlock}

CONTACT INFO RULE:
- If the customer asks for a phone number, LINE, WhatsApp, or email, answer directly from the verified contact information above — do not say "the team will contact you" instead.
- Never invent a contact channel that is not listed above.`;

    /**
     * -------------------------------------------------------
     * 3. Initial OpenAI request
     * -------------------------------------------------------
     */
    const usage = createUsageTotals();

    // Chat Completions keeps the tool-call conversation in the standard
    // user -> assistant(tool_calls) -> tool -> assistant sequence.
    // Drop assistant turns that are leaked tool-call JSON (already sent to
    // customers before the output guard existed) so the model does not
    // imitate its own earlier mistake.
    const modelUserMessage = selectedOption
      ? `ลูกค้าเลือกโปรแกรม "${selectedOption.label}" จากรายการก่อนหน้า`
      : userMessage;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: `${instructions}\n\n${structuredJourneyState}\n\n${conversationState}` },
      ...cleanHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: modelUserMessage },
    ];

    const chatTools = tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    // Program ids the model is allowed to pass to getProgramDetails: ids that
    // already appear in the context, plus every id searchPrograms returns
    // during this run. Anything else (e.g. "ProgramID", "12345") is rejected
    // before it reaches the database.
    const knownProgramIds = collectUuidsFromMessages(messages);

    // Counts searchPrograms calls that returned nothing (see tool-guard.ts).
    const searchState = { emptyCount: 0 };

    // Programs returned by real tool calls in this run. If the model cannot
    // turn them into a readable answer, we build one from these directly.
    let verifiedPrograms: VerifiedProgram[] = [];

    const normalizeLaoCatalogQuery = (message: string): string => {
      let query = message;
      const aliases = [
        ['ອຸດອນທານີ', 'อุดรธานี'], ['ອຸດອນ', 'อุดรธานี'],
        ['ອຸດຮ', 'อุดรธานี'], ['ອຸດຣ', 'อุดรธานี'],
        ['ວຽງຈັນ', 'เวียงจันทน์'], ['ໂປຣແກຣມ', 'โปรแกรม'],
        ['ໂຄງການ', 'โปรแกรม'], ['ບໍລິການ', 'บริการ'],
        ['ກວດສຸຂະພາບ', 'ตรวจสุขภาพ'], ['ຮັກສາ', 'รักษา'],
        ['ໂຮງໝໍ', 'โรงพยาบาล'], ['ລົດ', 'รถ'],
        ['ໂຮງແຮມ', 'โรงแรม'], ['ທ່ຽວ', 'ทริป'],
      ];
      for (const [from, to] of aliases) query = query.replaceAll(from, to);
      if (query.includes('อุดรธานี') && /โปรแกรม|บริการ/.test(query)) return 'อุดรธานี';
      return query;
    };

    const shouldForceProgramLookup = (message: string): boolean => {
      const text = message.trim().toLowerCase();
      if (!text) return false;

      // Explicit catalog intent is always a program lookup.
      const overviewTerms = [
        '\u0e08\u0e31\u0e07\u0e2b\u0e27\u0e31\u0e14',
        '\u0e21\u0e35\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21',
        '\u0e21\u0e35\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23',
        'which provinces',
        'what provinces',
        'available programs',
        'available services',
      ];
      if (overviewTerms.some((term) => text.includes(term))) return true;

      const explicitCatalogTerms = [
        'โปรแกรม', 'program', 'programs',
        'บริการ', 'service', 'services',
        'แพ็กเกจ', 'package', 'packages',
      ];
      return explicitCatalogTerms.some((term) => text.includes(term));
    };
    const shouldForceHotelAvailability = (message: string): boolean => {
      const text = message.trim().toLowerCase();
      const hasHotel = ['hotel', 'hotels', 'room', 'rooms', 'โรงแรม', 'ห้องพัก', 'ที่พัก'].some((term) => text.includes(term));
      const hasDate = /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(text) || ['เข้าพัก', 'เช็คอิน', 'เช็กอิน', 'checkout', 'check-out', 'คืน'].some((term) => text.includes(term));
      return hasHotel && hasDate;
    };

    // Catalog truth should come from WOS operational data, not from the
    // local model deciding whether to call a tool. This direct retrieval
    // path also handles natural service queries such as "ตรวจเข่า" that
    // do not contain the literal word "โปรแกรม".
    //
    // Most importantly, do NOT attach tools to ordinary conversation:
    // Typhoon's Ollama template turns a user message + tools into a
    // function-call response even for greetings. We therefore search the
    // verified catalog first and only use model tools for workflows that
    // genuinely need them (currently hotel availability).
    if (!shouldForceHotelAvailability(modelUserMessage) && !selectedOption) {
      try {
        const catalogQuery = customerLanguage === 'lo'
          ? normalizeLaoCatalogQuery(userMessage)
          : userMessage;
        const directCatalogPrograms = await searchPrograms(catalogQuery, 5);
        const directCatalogAnswer = buildProgramAnswer(
          directCatalogPrograms,
          userMessage,
          languageHistory.join('\\n'),
          customerLanguage
        );

        if (directCatalogAnswer) {
          console.log(
            '[WOS_AI] direct catalog retrieval answer',
            JSON.stringify({ programs: directCatalogPrograms.length })
          );
          return directCatalogAnswer;
        }

        if (shouldForceProgramLookup(modelUserMessage) && directCatalogPrograms.length === 0) {
          if (customerLanguage === 'lo') {
            return 'ຕອນນີ້ໃບເຟີນຍັງບໍ່ພົບໂປຣແກຣມ WOS ທີ່ກົງກັບຄຳຖາມນີ້ຈາກຂໍ້ມູນທີ່ຢືນຢັນໄດ້ຄ່ະ ຖ້າຕ້ອງການ ໃບເຟີນຊ່ວຍປະສານທີມ WOS ໃຫ້ກວດສອບຕໍ່ໄດ້ຄ່ະ';
          }
          if (customerLanguage === 'en') {
            return 'I could not find a verified WOS program that matches this request right now. I can help ask the WOS team to check further.';
          }
          return 'ตอนนี้ใบเฟิร์นยังไม่พบโปรแกรม WOS ที่ตรงกับคำถามนี้จากข้อมูลที่ยืนยันได้ค่ะ ถ้าต้องการ ใบเฟิร์นช่วยประสานทีม WOS ให้ตรวจสอบต่อได้ค่ะ';
        }
      } catch (catalogError) {
        console.warn(
          '[WOS_AI_DIRECT_CATALOG_LOOKUP_FAILED]',
          catalogError instanceof Error ? catalogError.message : String(catalogError)
        );
      }
    }

    // withTools=false is used to get a plain-text answer: with tools attached,
    // the typhoon2 template forces a function-call JSON reply whenever the last
    // message is from the user.
    const createCompletion = (withTools: boolean) =>
      withTools
        ? getOpenAI().chat.completions.create({
            model: runtimeEnv('LITELLM_MODEL') || 'gpt-5.6-luna',
            messages,
            tools: chatTools,
            tool_choice:
              shouldForceHotelAvailability(modelUserMessage)
                ? {
                    type: 'function' as const,
                    function: { name: 'searchHotelAvailability' },
                  }
                : shouldForceProgramLookup(modelUserMessage) || Boolean(selectedOption)
                  ? {
                      type: 'function' as const,
                      function: { name: 'searchPrograms' },
                    }
                  : 'auto',
          })
        : getOpenAI().chat.completions.create({
            model: runtimeEnv('LITELLM_MODEL') || 'gpt-5.6-luna',
            messages,
          });

    // LiteLLM/provider failures can be transient while the gateway itself
    // remains healthy. Retry only idempotent completion calls; tool execution
    // happens after a successful response and is never retried here.
    const complete = async (withTools = true) => {
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await createCompletion(withTools);
        } catch (error) {
          const status = (error as { status?: number } | null)?.status;
          const retryable = [429, 500, 502, 503, 504].includes(status ?? 0);
          if (!retryable || attempt === maxAttempts) throw error;
          const delayMs = attempt === 1 ? 500 : 1200;
          console.warn(
            '[WOS_OPENAI_RETRY]',
            JSON.stringify({ attempt, nextAttempt: attempt + 1, status, delayMs })
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      throw new Error('Unreachable completion retry state');
    };

    // Runs the tool-call rounds for one model response and returns the last
// response (the one that should hold the final customer-facing text).
const stripSerializedToolFence = (text: string): string => {
  const trimmed = text.trim();

  const match = trimmed.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/i
  );

  return match ? match[1].trim() : trimmed;
};

const runToolRounds = async (
  initial: Awaited<ReturnType<typeof complete>>
) => {
  let current = initial;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = current.choices[0]?.message;

    let toolCalls =
      message?.tool_calls?.filter(
        (
          call
        ): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          call.type === 'function'
      ) ?? [];

    /**
     * Typhoon/Ollama may serialize a function call into message.content
     * instead of returning native message.tool_calls.
     *
     * Convert that serialized call into the same internal shape used by
     * native tool calls, then continue through normalizeToolCall(),
     * validateToolArgs(), executeTool(), and the normal tool-result loop.
     */
    if (
      toolCalls.length === 0 &&
      looksLikeLeakedToolCall(message?.content)
    ) {
      try {
        const raw = message.content?.trim() ?? '';
        const parsed = JSON.parse(
          stripSerializedToolFence(raw)
        ) as {
          type?: unknown;
          function?: unknown;
          arguments?: unknown;
        };

        if (
          parsed &&
          parsed.type === 'function' &&
          typeof parsed.function === 'string'
        ) {
          const rawArguments =
            typeof parsed.arguments === 'string'
              ? parsed.arguments
              : JSON.stringify(parsed.arguments ?? {});

          toolCalls = [
            {
              id: `leaked-tool-${round + 1}`,
              type: 'function',
              function: {
                name: parsed.function,
                arguments: rawArguments,
              },
            },
          ];

          console.warn(
            '[WOS_AI_LEAKED_TOOL_CALL_EXECUTING]',
            JSON.stringify({
              name: parsed.function,
              round: round + 1,
            })
          );
        }
      } catch (error) {
        console.warn(
          '[WOS_AI_LEAKED_TOOL_CALL_PARSE_ERROR]',
          error instanceof Error
            ? error.message
            : String(error)
        );
      }
    }

    if (toolCalls.length === 0) {
      break;
    }

    // Normalize every call first. Some models send name="function" with
    // the real tool name inside the arguments; repairing it here also
    // keeps malformed calls out of the context we send back.
    const allPrepared = toolCalls.map((call) => {
      let parsed: unknown = {};
      let parseError = false;

      const rawArguments = call.function.arguments || '{}';

      // Log only safe metadata BEFORE JSON.parse and before any of our own
      // code touches the arguments. We intentionally do not log the raw
      // argument value because tool arguments may contain customer text.
      // The Unicode code-point list helps distinguish Thai characters from
      // suspicious non-ASCII sequences without exposing the original value.
      console.log(
        '[WOS_AI_DEBUG] raw tool_call.function.arguments (pre-parse):',
        JSON.stringify({
          name: call.function.name,
          length: rawArguments.length,
          byteLength: Buffer.byteLength(rawArguments, 'utf8'),
          nonAsciiCodePoints: Array.from(rawArguments)
            .map((ch) => ch.codePointAt(0) ?? 0)
            .filter((cp) => cp > 0x7f)
            .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`)
            .filter((cp, index, arr) => arr.indexOf(cp) === index)
            .slice(0, 32),
        })
      );

      try {
        parsed = JSON.parse(rawArguments);
      } catch {
        parseError = true;
      }

      const normalized = normalizeToolCall(
        call.function.name,
        parsed
      );

      if (normalized.repaired) {
        console.warn(
          '[WOS_AI_TOOL_REPAIRED]',
          JSON.stringify({
            from: call.function.name,
            to: normalized.name,
          })
        );
      }

      return {
        call,
        normalized,
        parseError,
      };
    });

    // The model said "no lookup needed": drop that no-op call and ask
    // again without tools so it answers the customer in plain text.
    const prepared = allPrepared.filter(
      ({ normalized }) => normalized.name !== NO_LOOKUP_TOOL
    );

    if (prepared.length === 0) {
      console.log('[WOS_AI_NO_LOOKUP]');
      current = await complete(false);
      addChatUsage(usage, current);
      break;
    }

    // Preserve the assistant tool-call message before appending
    // the corresponding tool results.
    messages.push({
      role: 'assistant',
      content: looksLikeLeakedToolCall(message?.content)
        ? ''
        : message?.content ?? '',
      tool_calls: prepared.map(({ call, normalized }) => ({
        id: call.id,
        type: 'function' as const,
        function: {
          name: normalized.name,
          arguments: JSON.stringify(normalized.args),
        },
      })),
    });

    for (const {
      call,
      normalized,
      parseError,
    } of prepared) {
      try {
        if (parseError) {
          throw new Error(
            'Tool arguments were not valid JSON'
          );
        }

        const rejection = validateToolArgs(
          normalized.name,
          normalized.args,
          knownProgramIds,
          searchState
        );

        let result: unknown;

        if (rejection) {
          console.warn(
            '[WOS_AI_TOOL_REJECTED]',
            normalized.name
          );

          result = rejection;
        } else {
          result = annotateToolResult(
            normalized.name,
            await executeTool(
              normalized.name,
              normalized.args,
              userMessage
            ),
            knownProgramIds,
            searchState
          );

          const found = extractVerifiedPrograms(
            normalized.name,
            result
          );

          if (found.length > 0) {
            verifiedPrograms = found;
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      } catch (toolError) {
        console.error(
          '[WOS_AI_TOOL_ERROR]',
          normalized.name,
          toolError
        );

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            success: false,
            message:
              'The requested WOS tool could not retrieve verified information.',
          }),
        });
      }
    }

    current = await complete(false);
    addChatUsage(usage, current);
  }

  return current;
};

    // Plain conversation must start WITHOUT tools. Typhoon's tool template
    // otherwise turns even greetings into function-call JSON. Catalog requests
    // have already been resolved directly above; hotel availability is the
    // remaining workflow that intentionally needs a tool round.
    const needsToolWorkflow = shouldForceHotelAvailability(modelUserMessage);
    let response = await complete(needsToolWorkflow);

    addChatUsage(usage, response);

    /**
     * -------------------------------------------------------
     * 4. Tool execution loop
     * -------------------------------------------------------
     */
    response = await runToolRounds(response);

    let finalText =
      response.choices[0]?.message?.content?.trim() || '';

    // Turn a model dead-end into a useful WOS-team escalation. This is
    // deliberately narrow: it fires only when the customer asks about WOS
    // and the model itself admits it cannot verify the answer.
    if (shouldEscalateWosGap(userMessage, finalText)) {
      console.warn('[WOS_AI_SMART_ESCALATION]', JSON.stringify({ reason: 'verified-knowledge-gap' }));
      finalText = buildSmartWosEscalation(customerLanguage);
    }

    // Language continuity guard. Typhoon-local can occasionally answer a
    // Thai multi-turn conversation in English when the latest user message
    // is only a number/short phrase. Re-ask once with an explicit Thai
    // instruction before anything reaches Chatwoot.
    const thaiConversation =
      /[\u0E00-\u0EFF]/.test(userMessage) ||
      cleanHistory.some((m) => /[\u0E00-\u0EFF]/.test(m.content));
    const englishReplyMarkers = [
      /^sure[\s—-]/i,
      /i checked the verified wos data/i,
      /if you like,? i can/i,
      /there is one program that matches/i,
      /found \d+ programs that match/i,
    ];
    const looksEnglishInThaiConversation =
      thaiConversation &&
      englishReplyMarkers.some((pattern) => pattern.test(finalText));

    if (looksEnglishInThaiConversation) {
      console.warn('[WOS_AI_LANGUAGE_RETRY]', JSON.stringify({ target: 'th' }));
      messages.push({
        role: 'user',
        content:
          '[System reminder] This conversation is in Thai. Rewrite your previous answer in natural Thai, keeping the verified program facts exactly the same. Do not switch to English. Do not add new facts.',
      });
      response = await complete(false);
      addChatUsage(usage, response);
      finalText = response.choices[0]?.message?.content?.trim() || '';
    }

    // A local-model repetition loop is never customer-facing. If it happens,
    // use the safe WOS escalation response rather than forwarding corrupted
    // Lao/Thai/English text. This is checked before persona normalization so
    // repeated particles cannot hide the underlying failure.
    if (looksLikeRepeatedLoop(finalText)) {
      console.error('[WOS_AI_REPETITION_GUARD]', JSON.stringify({ length: finalText.length }));
      finalText = buildFallbackReply(userMessage);
    }

    // Enforce Fern's Thai feminine voice at the final customer-facing
    // boundary. This is intentionally after all model retries so a local
    // model cannot reintroduce masculine particles in its last response.
    finalText = normalizeFernThaiReply(finalText, thaiConversation);

    /**
     * Output guard: the model sometimes writes a tool call as plain text
     * (e.g. {"type":"function","function":"searchPrograms",...}) instead of
     * using native tool_calls. Never send that to the customer - re-ask
     * the model, and fall back if it happens again.
     */
    for (
      let attempt = 1;
      attempt <= MAX_LEAK_RETRIES && looksLikeLeakedToolCall(finalText);
      attempt++
    ) {
      console.warn(
  '[WOS_AI_LEAKED_TOOL_CALL]',
  JSON.stringify({
    attempt,
    finalText,
  })
);

      // Re-sending the identical request tends to reproduce the identical
      // mistake, so tell the model explicitly what went wrong.
      messages.push({
        role: 'user',
        content:
          '[System reminder] Your previous reply was raw JSON / a tool call, which the customer cannot read. Reply again with a short, friendly natural-language answer for the customer based on the tool results above. No JSON, no field names, no ids.',
      });

      // No tools here: with tools attached and a user message last, the
      // typhoon2 template demands another function-call JSON reply.
      response = await complete(false);
      addChatUsage(usage, response);
      response = await runToolRounds(response);

      finalText = response.choices[0]?.message?.content?.trim() || '';
    }

    finalText = normalizeFernThaiReply(finalText, thaiConversation);

    console.log(
      '[WOS_AI_USAGE]',
      JSON.stringify({
        ...usage,
        knowledgeArticles: knowledge.length,
        instructionsChars: instructions.length,
      })
    );

    /**
     * -------------------------------------------------------
     * 5. Final customer-facing response
     * -------------------------------------------------------
     */
    // Verified program data always wins when it exists: the model
    // (typhoon-local) has been observed ignoring successful tool results
    // and answering generically instead of using the data it just fetched.
    // Rather than trust the model to phrase found programs correctly,
    // build the customer-facing answer straight from the verified data.
    const languageContext = languageHistory.join('\n');
    const programAnswer = buildProgramAnswer(
      verifiedPrograms,
      userMessage,
      languageContext,
      customerLanguage
    );

    // For catalog/program results, prefer the server-built response because
    // every fact in it is taken directly from verified WOS data. This also
    // prevents the local model from replacing a successful catalog lookup
    // with a generic conversational answer. The builder keeps the wording
    // warm and human while preserving exact operational values.
    if (programAnswer) {
      console.log(
        '[WOS_AI] using verified catalog answer',
        JSON.stringify({ programs: verifiedPrograms.length })
      );
      return programAnswer;
    }

    if (finalText && !looksLikeLeakedToolCall(finalText)) {
      return finalText;
    }

    if (programAnswer) {
      console.warn(
        '[WOS_AI] using server-built answer from verified program data',
        JSON.stringify({ programs: verifiedPrograms.length })
      );
      return programAnswer;
    }

    // Either the model was still requesting tools after MAX_TOOL_ROUNDS (or
    // returned nothing), or it kept leaking tool-call text after the retry.
    // Never send the customer an empty message or raw JSON.
    if (finalText) {
      console.error(
        '[WOS_AI] leaked tool-call text persisted after retry, sending fallback'
      );
    } else {
      console.warn('[WOS_AI] empty final answer after tool rounds');
    }
    return buildFallbackReply(userMessage);
  } catch (error) {
    console.error(
      '[WOS_OPENAI_ERROR]',
      JSON.stringify(describeError(error))
    );

    // If the LLM gateway is temporarily unavailable, keep catalog requests
    // useful by querying the verified operational catalog directly.
    const fallbackCatalogTerms = [
      'โปรแกรม', 'บริการ', 'แพ็กเกจ', 'package', 'packages',
      'program', 'programs', 'service', 'services',
    ];
    const wantsCatalog = fallbackCatalogTerms.some((term) =>
      userMessage.toLowerCase().includes(term.toLowerCase())
    );

    if (wantsCatalog) {
      try {
        const fallbackPrograms = await searchPrograms(userMessage, 5);
        const fallbackAnswer = buildProgramAnswer(
          fallbackPrograms,
          userMessage,
          history.filter((m) => m.role === 'user').map((m) => m.content).join('\n'),
          detectWosLanguage(userMessage, history.filter((m) => m.role === 'user').map((m) => m.content))
        );
        if (fallbackAnswer) {
          console.warn(
            '[WOS_AI_LLM_FALLBACK_CATALOG]',
            JSON.stringify({ programs: fallbackPrograms.length })
          );
          return fallbackAnswer;
        }
      } catch (fallbackError) {
        console.error(
          '[WOS_AI_LLM_FALLBACK_ERROR]',
          JSON.stringify(describeError(fallbackError))
        );
      }
    }

    // Never expose an upstream 500/503 directly to the customer.
    return buildFallbackReply(userMessage);
  }
}
