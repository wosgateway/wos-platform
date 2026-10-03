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
  needs: readonly ('health' | 'treatment' | 'transport' | 'hotel' | 'trip')[];
  activeNeed?: 'health' | 'treatment' | 'transport' | 'hotel' | 'trip';
  tripDurationDays?: number;
  budgetUnlimited?: boolean;
  transportNeeded?: boolean;
  transportMode?: 'one_way' | 'daily';
  serviceTime?: string;
  hotelNeeded?: boolean;
  roomType?: 'double' | 'twin';
  hotelBudgetThb?: number;
  customerName?: string;
  bookingIntent?: boolean;
  transportDate?: string;
  transportTime?: string;
  transportTravelers?: number;
  transportOrigin?: string;
  transportDestination?: string;
  hotelTravelers?: number;
  hotelRooms?: number;
};

export type WosConciergeStage =
  | 'collecting_booking'
  | 'ask_transport_interest'
  | 'collecting_transport'
  | 'ask_hotel_interest'
  | 'collecting_hotel'
  | 'awaiting_confirmation';

export function getWosConciergeStage(state: WosJourneyState): WosConciergeStage {
  // Health/treatment program bookings have their own core fields.
  // Trip-only fields such as destination, travelers, and budget are not
  // required unless the customer actually asks for a trip.
  const coreReady = state.selectedProgram
    ? Boolean(state.serviceDate && state.serviceTime)
    : (Boolean(state.destination) && Boolean(state.serviceDate) && Boolean(state.travelers));
  if (!coreReady) return 'collecting_booking';
  if (state.transportNeeded === undefined) return 'ask_transport_interest';
  // V1 only captures transport interest + pickup point.
  // WOS Admin will collect the remaining transfer details directly.
  if (state.transportNeeded && !state.transportOrigin) return 'collecting_transport';
  if (state.hotelNeeded === undefined) return 'ask_hotel_interest';
  // V1 only records hotel interest. Admin will collect room/stay details.
  if (state.hotelNeeded) return 'awaiting_confirmation';
  return 'awaiting_confirmation';
}

const TH_PROVINCES = ['กรุงเทพมหานคร', 'อุดรธานี', 'หนองคาย', 'ขอนแก่น', 'เชียงใหม่', 'ภูเก็ต', 'ชลบุรี', 'นครราชสีมา'];
const LOCATION_ALIASES: Record<string, string> = {
  'เวียงจัน': 'เวียงจันทน์',
  'เวียงจันทน์': 'เวียงจันทน์',
  'อุดร': 'อุดรธานี',
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
  const explicit = findLastMatch(texts, /(?:ไป|เดินทางไป|destination|to)\s*(อุดรธานี|อุดร|หนองคาย|ขอนแก่น|เชียงใหม่|กรุงเทพมหานคร|ภูเก็ต|ชลบุรี|นครราชสีมา)/iu);
  return explicit ? normalizeLocation(explicit) : undefined;
}

function findOrigin(texts: string[]): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i];
    const lao = text.match(/(?:ຈາກ|ເດີນທາງຈາກ|from)\s*([^,\n]+)/iu);
    if (lao?.[1]) return normalizeLocation(lao[1]);
    const pickup = text.match(/(?:รับที่|รับจาก|จุดรับ|pickup)\s*(เวียงจัน(?:ทน์)?|อุดรธานี|หนองคาย|ขอนแก่น|กรุงเทพมหานคร|เวียงจันทน์|ວຽງຈັນ)/iu);
    if (pickup?.[1]) return normalizeLocation(pickup[1]);
    const thai = text.match(/(?:จาก|เดินทางจาก|origin|from)\s*(เวียงจัน(?:ทน์)?|อุดร(?:ธานี)?|หนองคาย|ขอนแก่น|เชียงใหม่|กรุงเทพมหานคร|ภูเก็ต|ชลบุรี|นครราชสีมา|ວຽງຈັນ)/iu);
    if (thai?.[1]) return normalizeLocation(thai[1]);
  }
  return undefined;
}

function normalizeLocation(value: string): string {
  const cleaned = value.replace(/[.。?？!！]+$/, '').trim();
  return LOCATION_ALIASES[cleaned] ?? cleaned;
}

function findDate(texts: string[]): string | undefined {
  return findLastMatch(texts, /(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:วันที่|วัน)\s*\d{1,2}(?:\s*(?:ตุลาคม|ตุลา|พฤศจิกายน|พฤศจิกา|ธันวาคม|ธันวา|มกราคม|มกรา|กุมภาพันธ์|กุมภา|มีนาคม|มีนา|เมษายน|เมษา|พฤษภาคม|พฤษภา|มิถุนายน|มิถุนา|กรกฎาคม|กรกฎา|สิงหาคม|สิงหา|กันยายน|กันยา)))/iu);
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

function findServiceTime(texts: string[]): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const match = texts[i].match(/(?:เวลา|ช่วงเวลา|ตอน)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:นาฬิกา|โมง|am|pm)?)/iu) ??
      texts[i].match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/iu) ??
      texts[i].match(/(?:^|\s)((?:\d{1,2})\s*(?:โมง|นาฬิกา))/iu);
    if (match?.[1]) return match[1].trim();
    if (/(?:บ่ายโมง|ช่วงบ่าย|ตอนบ่าย)/iu.test(texts[i])) return '13:00';
    if (/(?:เที่ยง|เที่ยงวัน)/iu.test(texts[i])) return '12:00';
    if (/(?:บ่ายสอง|บ่าย 2|ช่วงบ่ายสอง)/iu.test(texts[i])) return '14:00';
    if (/(?:บ่ายสาม|บ่าย 3|ช่วงบ่ายสาม)/iu.test(texts[i])) return '15:00';
    if (/(?:บ่ายสี่|บ่าย 4|สี่โมงเย็น)/iu.test(texts[i])) return '16:00';
    if (/(?:บ่ายห้า|บ่าย 5|ห้าโมงเย็น)/iu.test(texts[i])) return '17:00';
  }
  return undefined;
}

function findBookingServiceTime(texts: string[]): string | undefined {
  const bookingTexts = texts.filter(
    (text) => !/(?:รถ|รถรับส่ง|รับวันที่|รับที่|รับจาก|จุดรับ|pickup|transport|transfer|shuttle)/iu.test(text)
  );
  return findServiceTime(bookingTexts);
}

function findTransportMode(texts: string[]): WosJourneyState['transportMode'] {
  for (let i = texts.length - 1; i >= 0; i--) {
    if (/(?:เหมารายวัน|รายวัน|daily)/iu.test(texts[i])) return 'daily';
    if (/(?:เที่ยวเดียว|one-way)/iu.test(texts[i])) return 'one_way';
  }
  return undefined;
}

function findHotelRoom(texts: string[]): WosJourneyState['roomType'] {
  for (let i = texts.length - 1; i >= 0; i--) {
    if (/(?:เตียงคู่|double)/iu.test(texts[i])) return 'double';
    if (/(?:เตียงเดี่ยว|twin)/iu.test(texts[i])) return 'twin';
  }
  return undefined;
}

function findPreference(texts: string[], positive: RegExp, negative: RegExp): boolean | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    if (negative.test(texts[i])) return false;
    if (positive.test(texts[i])) return true;
  }
  return undefined;
}

function findCustomerName(texts: string[]): string | undefined {
  return findLastMatch(texts, /(?:ชื่อนาย|ชื่อนางสาว|ชื่อนาง|ชื่อ|ผมชื่อ|ฉันชื่อ|ดิฉันชื่อ)\s*([ก-๙A-Za-z][ก-๙A-Za-z .'-]{1,60})/iu);
}

function findRooms(texts: string[]): number | undefined {
  const explicit = findLastMatch(texts, /(?:จำนวน|ต้องการ|เอา)\s*(\d{1,2})\s*(?:ห้อง|rooms?)/iu);
  if (explicit) return Number(explicit);
  const simple = findLastMatch(texts, /(?:^|\s)(\d{1,2})\s*(?:ห้อง|rooms?)(?:\s|$)/iu);
  return simple ? Number(simple) : undefined;
}

function findHotelTravelers(texts: string[]): number | undefined {
  return findLastMatch(texts, /(?:พัก|เข้าพัก|ผู้เข้าพัก|ผู้เดินทาง|สำหรับ)\s*(\d{1,2})\s*(?:คน|ท่าน|guests?)/iu) ? Number(findLastMatch(texts, /(?:พัก|เข้าพัก|ผู้เข้าพัก|ผู้เดินทาง|สำหรับ)\s*(\d{1,2})\s*(?:คน|ท่าน|guests?)/iu)) : undefined;
}

function findHotelBudget(texts: string[]): number | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const match = texts[i].match(/(?:ห้องพัก|โรงแรม|ที่พัก).*?(?:งบ|ประมาณ)\s*([0-9][0-9,]*)/iu);
    if (match?.[1]) return Number(match[1].replace(/,/g, ''));
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
  const latest = [...optionMessages].reverse().find((message) => /\d/.test(message.content));
  const selectedIndex = currentMessage.trim().match(/^(\d{1,2})[.)]?$/)?.[1];
  const pickFromOptions = (options: string, index: string): { title: string } | undefined => {
    const numbered = [...options.matchAll(/^\s*(\d+)[.)]\s*(.+)$/gm)];
    const picked = numbered.find((item) => item[1] === index);
    if (!picked?.[2]) return undefined;
    const line = picked[2].trim();
    return { title: line.split(/\s+-\s+|\s+—\s+/)[0].trim() || line };
  };
  if (latest && selectedIndex) {
    const picked = pickFromOptions(latest.content, selectedIndex);
    if (picked) return picked;
  }

  // Preserve the most recent numeric program selection across later turns.
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue;
    const priorIndex = history[i].content.trim().match(/^(\d{1,2})[.)]?$/)?.[1];
    if (!priorIndex) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (history[j].role !== 'assistant' || !/\d/.test(history[j].content)) continue;
      const picked = pickFromOptions(history[j].content, priorIndex);
      if (picked) return picked;
      break;
    }
  }

  const named = currentMessage.match(/(?:สนใจ|เลือก|เอา|ต้องการ|interested in|choose)\s*["“]?([^"”\n]+?)["”]?(?:\s|$)/iu);
  if (named?.[1] && !/^(?:รายการนี้|ตัวนี้|อันนี้|this one|this item)$/iu.test(named[1].trim())) {
    return { title: named[1].trim() };
  }

  // "รายการนี้/อันนี้/this one" means keep the most recent explicit
  // customer selection. Never infer a selection from an assistant catalog.
  if (/(?:สนใจ|เลือก|เอา|ต้องการ)\s*(?:รายการนี้|ตัวนี้|อันนี้)|\b(?:this one|this item)\b/iu.test(currentMessage)) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role !== 'user') continue;
      const prior = history[i].content.match(/(?:สนใจ|เลือก|เอา|ต้องการ)\s*["“]?([^"”\n]+?)["”]?(?:\s|$)/iu);
      if (prior?.[1] && !/^(?:รายการนี้|ตัวนี้|อันนี้|this one|this item)$/iu.test(prior[1].trim())) {
        return { title: prior[1].trim() };
      }
    }
  }

  return undefined;
}

export function deriveWosJourneyState(history: WosAIHistoryMessage[], currentMessage: string): WosJourneyState {
  const userTexts = history.filter((m) => m.role === 'user').map((m) => m.content);
  const allTexts = [...userTexts, currentMessage];
  const lower = allTexts.join('\n').toLowerCase();
  const needs: Array<'health' | 'treatment' | 'transport' | 'hotel' | 'trip'> = [];
  const add = (need: WosJourneyState['needs'][number]) => { if (!needs.includes(need)) needs.push(need); };

  if (/(ตรวจสุขภาพ|สุขภาพ|wellness|health check|ສຸຂະພາບ|ກວດສຸຂະພາບ)/iu.test(lower)) add('health');
  if (/(รักษา|พบแพทย์|หมอ|treatment|doctor|surgery|ຮັກສາ|ໝໍ)/iu.test(lower)) add('treatment');
  if (/(รถ|รับส่ง|transport|transfer|shuttle|ລົດ|ຮັບສົ່ງ)/iu.test(lower)) add('transport');
  if (/(โรงแรม|ที่พัก|hotel|accommodation|room|ໂຮງແຮມ|ທີ່ພັກ)/iu.test(lower)) add('hotel');
  if (/(ไปอุดร|เที่ยว|ทริป|เดินทาง|trip|travel|ທ່ອງທ່ຽວ|ເດີນທາງ)/iu.test(lower)) add('trip');

  const selected = latestSelectedProgram(history, currentMessage);
  const explicitCustomerName = findCustomerName(allTexts);
  const lastAssistantMessage = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  const bareNamePattern = /^[ก-๙A-Za-z][ก-๙A-Za-z .'-]{1,60}$/u;
  const nameRequestPattern = /(?:ขอชื่อ|ชื่อสำหรับ|what name|name should I use|ຂໍຊື່)/iu;
  let bareCustomerName: string | undefined;
  if (!explicitCustomerName) {
    if (nameRequestPattern.test(lastAssistantMessage) && bareNamePattern.test(currentMessage.trim())) {
      bareCustomerName = currentMessage.trim();
    } else {
      for (let i = history.length - 1; i >= 1; i--) {
        if (history[i].role !== 'user' || !bareNamePattern.test(history[i].content.trim())) continue;
        const previousAssistant = history[i - 1];
        if (previousAssistant?.role === 'assistant' && nameRequestPattern.test(previousAssistant.content)) {
          bareCustomerName = history[i].content.trim();
          break;
        }
      }
    }
  }
  const customerName = explicitCustomerName ?? bareCustomerName;
  const destination = findDestination(allTexts) ?? findProvince(allTexts);
  const activeNeed = /(?:รถ|รถรับส่ง|รับที่|รับจาก|มารับ|รับส่ง|transport|transfer|shuttle)/iu.test(currentMessage)
    ? 'transport'
    : /(?:ปวดเข่า|ตรวจเข่า|เข่า|รักษา|หาหมอ|พบแพทย์|treatment|doctor|surgery)/iu.test(currentMessage)
      ? 'treatment'
      : /(?:hotel|โรงแรม|ที่พัก)/iu.test(currentMessage)
        ? 'hotel'
        : /(?:trip|เที่ยว|เดินทาง|ไปอุดร|ไปเชียงใหม่)/iu.test(currentMessage)
          ? 'trip'
          : /(?:สุขภาพ|ตรวจสุขภาพ|wellness|health|นวด|สปา|spa|massage)/iu.test(currentMessage)
            ? 'health'
            : needs[needs.length - 1];
  const noAddons = /^(?:ไม่|ไม่ต้องการ|ไม่เอา|ไม่ต้องการทั้งสอง|ไม่เอาทั้งสอง|no|none|ບໍ່|ບໍ່ຕ້ອງການ)$/iu.test(currentMessage.trim());
  const derivedTransportNeeded = noAddons ? false : findPreference(allTexts, /(?:ต้องการ|เอา|ขอ|สนใจ).*?(?:รถ|รถรับส่ง)|(?:need|want|interested).*?(?:transport|transfer)/iu, /(?:ไม่ต้องการ|ไม่เอา|ไม่ขอ).*?(?:รถ|รถรับส่ง)|(?:don't|do not|no).*?(?:transport|transfer)/iu);
  const derivedHotelNeeded = noAddons ? false : findPreference(allTexts, /(?:ต้องการ|เอา|ขอ|สนใจ).*?(?:โรงแรม|ที่พัก|ห้องพัก)|(?:need|want|interested).*?(?:hotel|room)/iu, /(?:ไม่ต้องการ|ไม่เอา|ไม่ขอ).*?(?:โรงแรม|ที่พัก|ห้องพัก)|(?:don't|do not|no).*?(?:hotel|room)/iu);
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
    transportMode: findTransportMode(allTexts),
    // Keep the health-service appointment time separate from later transport time.
    serviceTime: findBookingServiceTime(allTexts),
    roomType: findHotelRoom(allTexts),
    hotelBudgetThb: findHotelBudget(allTexts),
    customerName,
    bookingIntent: Boolean(selected?.title) || /(?:จอง|booking|book|reserve|ຈອງ)/iu.test(lower),
    transportDate: findDate(allTexts),
    transportTime: findServiceTime(allTexts),
    transportTravelers: findTravelers(allTexts),
    transportOrigin: findOrigin(allTexts),
    transportDestination: findDestination(allTexts),
    hotelTravelers: findHotelTravelers(allTexts) ?? findTravelers(allTexts) ?? (/(?:โรงแรม|ที่พัก|ห้องพัก|hotel|room)/iu.test(currentMessage) ? findTravelers([currentMessage]) : undefined),
    hotelRooms: findRooms(allTexts),
    transportNeeded: derivedTransportNeeded,
    hotelNeeded: derivedHotelNeeded,
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
