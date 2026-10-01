import type { WosLanguage } from './language-dictionary';
import type { WosAIHistoryMessage } from './core';

export type WosJourneyState = {
  destination?: string;
  origin?: string;
  budgetThb?: number;
  travelers?: number;
  serviceDate?: string;
  checkin?: string;
  checkout?: string;
  selectedProgram?: string;
  selectedProvider?: string;
  needs: Array<'health' | 'treatment' | 'transport' | 'hotel' | 'trip'>;
  activeNeed?: 'health' | 'treatment' | 'transport' | 'hotel' | 'trip';
  tripDurationDays?: number;
  budgetUnlimited?: boolean;
};

const TH_PROVINCES = ['กรุงเทพมหานคร', 'อุดรธานี', 'หนองคาย', 'ขอนแก่น', 'เชียงใหม่', 'ภูเก็ต', 'ชลบุรี', 'นครราชสีมา'];
const LAO_LOCATION_ALIASES: Record<string, string> = {
  'ວຽງຈັນ': 'เวียงจันทน์',
  'ອຸດອອນ': 'อุดรธานี',
  'ອຸດອນ': 'อุดรธานี',
  'ຫນອງຄາຍ': 'หนองคาย',
};

function findLastMatch(texts: string[], regex: RegExp): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const match = texts[i].match(regex);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function findBudget(texts: string[]): number | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const match = texts[i].match(/(?:งบ|budget|ไม่เกิน|under|ประมาณ)\s*(?:ประมาณ\s*)?([0-9][0-9,]*)\s*(?:บาท|thb|฿)?/iu);
    if (match?.[1]) return Number(match[1].replace(/,/g, ''));
    const lao = texts[i].match(/(?:ງົບ|ບໍ່ເກີນ|budget)\s*([0-9][0-9,]*)/iu);
    if (lao?.[1]) return Number(lao[1].replace(/,/g, ''));
  }
  return undefined;
}

function findTravelers(texts: string[]): number | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i];
    const match = text.match(/(?:ผู้เดินทาง|ผู้โดยสาร|จำนวนคน|travelers|guests|people|มี)\s*(?:ประมาณ\s*)?(\d{1,2})\s*(?:คน)?/iu);
    if (match?.[1] && /(?:ผู้เดินทาง|ผู้โดยสาร|จำนวนคน|travelers|guests|people|มี)/iu.test(text)) return Number(match[1]);
    const thaiAfterNumber = text.match(/(?:^|\s)(\d{1,2})\s*คน(?:\s|$)/iu);
    if (thaiAfterNumber?.[1]) return Number(thaiAfterNumber[1]);
    const lao = text.match(/(?:ມີ\s*)?(\d{1,2})\s*ຄົນ/iu);
    if (lao?.[1]) return Number(lao[1]);
  }
  return undefined;
}

function findProvince(texts: string[]): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const found = TH_PROVINCES.find((province) => texts[i].includes(province));
    if (found) return found;
  }
  return undefined;
}

function findDestination(texts: string[]): string | undefined {
  const explicit = findLastMatch(texts, /(?:ไป|เดินทางไป|destination|to)\s*(อุดรธานี|หนองคาย|ขอนแก่น|เชียงใหม่|กรุงเทพมหานคร|ภูเก็ต|ชลบุรี|นครราชสีมา)/iu);
  return explicit;
}

function findOrigin(texts: string[]): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i];
    const lao = text.match(/(?:ຈາກ|ເດີນທາງຈາກ|from)\s*([^,\n]+)/iu);
    if (lao?.[1]) return normalizeLocation(lao[1]);
    const thai = text.match(/(?:จาก|เดินทางจาก|origin|from)\s*([^,\n]+)/iu);
    if (thai?.[1]) return normalizeLocation(thai[1]);
  }
  return undefined;
}

function normalizeLocation(value: string): string {
  const cleaned = value.replace(/[.。?？!！]+$/, '').trim();
  return LAO_LOCATION_ALIASES[cleaned] ?? cleaned;
}

function findDate(texts: string[]): string | undefined {
  return findLastMatch(texts, /(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:วันที่|วัน)\s*\d{1,2}(?:\s*(?:ตุลา|ตุลาคม|พฤศจิกา|พฤศจิกายน|ธันวา|ธันวาคม|มกรา|มกราคม|กุมภา|กุมภาพันธ์|มีนา|มีนาคม|เมษา|เมษายน|พฤษภา|พฤษภาคม|มิถุนา|มิถุนายน|กรกฎา|กรกฎาคม|สิงหา|สิงหาคม|กันยา|กันยายน)))/iu);
}

function findTripDuration(texts: string[]): number | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const match = texts[i].match(/(?:ไป|เที่ยว|พัก|อยู่|เดินทาง).*?(\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*(?:วัน|คืน)|(?:\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*(?:วัน|คืน)/iu);
    if (match?.[1]) {
      const words: Record<string, number> = { หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10 };
      return Number(match[1]) || words[match[1]];
    }
  }
  return undefined;
}

function findUnlimitedBudget(texts: string[]): boolean {
  for (let i = texts.length - 1; i >= 0; i--) {
    if (/(?:งบ\s*\d|งบประมาณ\s*\d|\d[\d,]*\s*บาท)/iu.test(texts[i])) return false;
    if (/(?:งบไม่จำกัด|งบไม่กำหนด|ไม่จำกัดงบ|unlimited budget|no budget limit)/iu.test(texts[i])) return true;
  }
  return false;
}

function latestSelectedProgram(history: WosAIHistoryMessage[], currentMessage = ''): { title: string; provider?: string } | undefined {
  const optionMessages = history.filter((m) => m.role === 'assistant');
  const latest = optionMessages[optionMessages.length - 1];
  const selectedIndex = currentMessage.trim().match(/^(\d{1,2})[.)]?$/)?.[1];
  if (latest && selectedIndex) {
    const numbered = [...latest.content.matchAll(/^\s*(\d+)[.)]\s*(.+)$/gm)];
    const picked = numbered.find((item) => item[1] === selectedIndex);
    if (picked?.[2]) {
      const line = picked[2].trim();
      return { title: line.split(/\s+-\s+|\s+—\s+/)[0].trim() || line };
    }
  }

  const named = currentMessage.match(/(?:สนใจ|เลือก|เอา|ต้องการ|interested in|choose)\s*["“]?([^"”\n]+?)["”]?(?:\s|$)/iu);
  if (named?.[1]) return { title: named[1].trim() };


  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.role !== 'assistant') continue;
    const numbered = [...message.content.matchAll(/^\s*(\d+)[.)]\s*(.+)$/gm)];
    if (numbered.length === 1) {
      const line = numbered[0][2].trim();
      return { title: line.split(/\s+-\s+|\s+—\s+/)[0].trim() || line };
    }
  }
  return undefined;
}

export function deriveWosJourneyState(history: WosAIHistoryMessage[], currentMessage: string): WosJourneyState {
  const userTexts = history.filter((m) => m.role === 'user').map((m) => m.content);
  const allTexts = [...userTexts, currentMessage];
  const lower = allTexts.join('\n').toLowerCase();
  const needs: WosJourneyState['needs'] = [];
  const add = (need: WosJourneyState['needs'][number]) => { if (!needs.includes(need)) needs.push(need); };

  if (/(ตรวจสุขภาพ|สุขภาพ|wellness|health check|ສຸຂະພາບ|ກວດສຸຂະພາບ)/iu.test(lower)) add('health');
  if (/(รักษา|พบแพทย์|หมอ|treatment|doctor|surgery|ຮັກສາ|ໝໍ)/iu.test(lower)) add('treatment');
  if (/(รถ|รับส่ง|transport|transfer|shuttle|ລົດ|ຮັບສົ່ງ)/iu.test(lower)) add('transport');
  if (/(โรงแรม|ที่พัก|hotel|accommodation|room|ໂຮງແຮມ|ທີ່ພັກ)/iu.test(lower)) add('hotel');
  if (/(ไปอุดร|เที่ยว|ทริป|เดินทาง|trip|travel|ທ່ອງທ່ຽວ|ເດີນທາງ)/iu.test(lower)) add('trip');

  const selected = latestSelectedProgram(history, currentMessage);
  const destination = findDestination(allTexts) ?? findProvince(allTexts);
  const activeNeed = /(?:ปวดเข่า|ตรวจเข่า|เข่า|รักษา|หาหมอ|พบแพทย์|treatment|doctor|surgery)/iu.test(currentMessage)
    ? 'treatment'
    : /(?:รถ|รถรับส่ง|transport|transfer|shuttle)/iu.test(currentMessage)
      ? 'transport'
      : /(?:hotel|โรงแรม|ที่พัก)/iu.test(currentMessage)
        ? 'hotel'
        : /(?:trip|เที่ยว|เดินทาง|ไปอุดร|ไปเชียงใหม่)/iu.test(currentMessage)
          ? 'trip'
          : /(?:สุขภาพ|ตรวจสุขภาพ|wellness|health)/iu.test(currentMessage)
            ? 'health'
            : needs[needs.length - 1];
  return {
    destination,
    origin: findOrigin(allTexts),
    budgetThb: findBudget(allTexts),
    travelers: findTravelers(allTexts),
    serviceDate: findDate(allTexts),
    checkin: findDate(allTexts),
    selectedProgram: selected?.title,
    selectedProvider: selected?.provider,
    needs,
    activeNeed,
    tripDurationDays: findTripDuration(allTexts),
    budgetUnlimited: findUnlimitedBudget(allTexts),
  };
}

export function formatJourneyState(state: WosJourneyState, language: WosLanguage): string {
  const lines = [
    state.origin ? `- Origin: ${state.origin}` : '- Origin: not captured',
    state.destination ? `- Destination: ${state.destination}` : '- Destination: not captured',
    state.budgetThb ? `- Budget THB: ${state.budgetThb}` : '- Budget THB: not captured',
    state.travelers ? `- Travelers: ${state.travelers}` : '- Travelers: not captured',
    state.serviceDate ? `- Date mentioned: ${state.serviceDate}` : '- Date: not captured',
    state.selectedProgram ? `- Selected program: ${state.selectedProgram}` : '- Selected program: not captured',
    `- Needs: ${state.needs.length ? state.needs.join(', ') : 'general'}`,
    state.activeNeed ? `- Active topic: ${state.activeNeed}` : '- Active topic: none',
    state.tripDurationDays ? `- Trip duration days: ${state.tripDurationDays}` : '- Trip duration: not captured',
    state.budgetUnlimited ? '- Budget: unlimited' : '',
  ];
  const lang = language === 'lo' ? 'Lao' : language === 'en' ? 'English' : 'Thai';
  return `STRUCTURED WOS JOURNEY STATE (derived, not a database fact; language=${lang}):\n${lines.join('\n')}\nUse this only to preserve conversation continuity. Never invent missing values. Missing fields must be collected from the customer or verified WOS systems.`;
}
