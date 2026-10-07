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
  transportDestinationSource?: 'program_default' | 'customer_override';
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
  // A selected program + customer name is enough to enter the concierge
  // flow. Date/time is operational detail that WOS Admin can confirm later;
  // Fern should first ask about transport/hotel and then summarize the request.
  const coreReady = state.selectedProgram
    ? Boolean(state.customerName)
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
  'ອຸດຮ': 'อุดรธานี',
  'ອຸດຣ': 'อุดรธานี',
  'ຫນອງຄາຍ': 'หนองคาย',
  'ໜອງຄາຍ': 'หนองคาย',
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
    const thai = text.match(/(?:จาก|เดินทางจาก|origin|from)\s*(เวียงจัน(?:ทน์)?|เวียงจันทน์|เวียงจัน|อุดร(?:ธานี)?|หนองคาย|ขอนแก่น|เชียงใหม่|กรุงเทพมหานคร|ภูเก็ต|ชลบุรี|นครราชสีมา|ວຽງຈັນ)/iu);
    if (thai?.[1]) return normalizeLocation(thai[1]);
  }
  return undefined;
}

function isAddonInterestMessage(message: string): boolean {
  return /(?:สนใจ|ต้องการ|เอา|ขอ).*?(?:รถ|รถรับส่ง|โรงแรม|ที่พัก|ห้องพัก|hotel|transport|transfer|shuttle)/iu.test(message)
    || /(?:รถ|รถรับส่ง|โรงแรม|ที่พัก|ห้องพัก|hotel|transport|transfer|shuttle).*?(?:มีไหม|มีมั้ย|ไหม|มั้ย)/iu.test(message);
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
    const match = texts[i].match(/(?:เวลา|ช่วงเวลา|ตอน)\s*(?:(?:สัก|ประมาณ|ราว(?:ๆ)?|ราวประมาณ)\s*)?(\d{1,2}(?:[:.]\d{2})?\s*(?:นาฬิกา|โมง|am|pm)?)/iu) ??
      texts[i].match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/iu) ??
      texts[i].match(/(?:^|\s)((?:\d{1,2})\s*(?:โมง|นาฬิกา))/iu);
    if (match?.[1]) return match[1].trim();
    if (/(?:บ่ายโมง|ช่วงบ่าย|ตอนบ่าย)/iu.test(texts[i])) return '13:00';
    if (/(?:เที่ยง|เที่ยงวัน)/iu.test(texts[i])) return '12:00';
    if (/(?:บ่ายสอง|บ่าย\s*2|ช่วงบ่ายสอง|ช่วงบ่าย\s*2)/iu.test(texts[i])) return '14:00';
    if (/(?:บ่ายสาม|บ่าย\s*3|ช่วงบ่ายสาม|ช่วงบ่าย\s*3)/iu.test(texts[i])) return '15:00';
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

function isJourneyResetMessage(message: string): boolean {
  const text = message.trim();
  return /^(?:เริ่มข้อมูลใหม่|เริ่มใหม่|เริ่มคุยใหม่|จองใหม่(?:เลย)?|ล้างข้อมูล(?:เดิม)?|เริ่มการจองใหม่|start over|start new|new booking|new journey|reset|clear previous|clear data|ລ້າງຂໍ້ມູນເກົ່າ|ລ້າງຂໍ້ມູນ|ເລີ່ມໃໝ່|ຈອງໃໝ່)$/iu.test(text);
}

function isGenericProgramRequest(message: string): boolean {
  const text = message.trim();
  return /(?:มี|ขอ|อยาก|สนใจ|แนะนำ).*?(?:โปรแกรม|บริการ).*?(?:อะไร|ไหน|บ้าง|แนะนำ)/iu.test(text)
    || /(?:โปรแกรม|บริการ)\s*(?:อะไร|ไหน|อะไรบ้าง|ไหนบ้าง)/iu.test(text);
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

  // Fern's concierge summary is also a durable signal. Once the original
  // numbered catalog has fallen out of the 20-message history window, recover
  // the selected program from the summary Fern already sent to the customer.
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.role !== 'assistant') continue;
    const programMatch = message.content.match(/(?:^|\n)\s*[•*-]\s*(?:โปรแกรม|ໂປຣແກຣມ|selected program)\s*:\s*([^\n]+)/iu);
    if (!programMatch?.[1]) continue;
    const title = programMatch[1].trim();
    if (!title) continue;
    const providerMatch = message.content.match(/(?:^|\n)\s*[•*-]\s*(?:ผู้ให้บริการ|ຜູ້ໃຫ້ບໍລິການ|provider)\s*:\s*([^\n]+)/iu);
    return { title, provider: providerMatch?.[1]?.trim() || undefined };
  }

  // Named selections such as "สนใจตรวจเข่า" must persist into later turns.
  // Numeric selections were already handled above; this branch matches the
  // latest customer message after the latest assistant catalog list against
  // the actual option labels instead of trusting the model to remember it.
  if (latest) {
    const optionList = [...latest.content.matchAll(/^\s*(\d+)[.)]\s*(.+)$/gm)].map((match) => {
      const line = match[2].trim();
      const parts = line.split(/\s+-\s+|\s+—\s+/);
      return {
        title: parts[0]?.trim() ?? line,
        provider: parts[1]?.trim(),
      };
    });
    const latestIndex = history.lastIndexOf(latest);
    const candidateMessages = [
      ...history.slice(latestIndex + 1).filter((message) => message.role === 'user').map((message) => message.content),
      currentMessage,
    ];
    for (const candidateMessage of candidateMessages) {
      const text = candidateMessage.trim().toLocaleLowerCase();
      const laoProgramAliases: Record<string, string[]> = {
        'ตรวจเข่า': ['ກວດເຂົ່າ', 'ກວດຫົວເຂົ່າ'],
        'ตรวจสุขภาพ': ['ກວດສຸຂະພາບ', 'ກວດສຸຂະພາບທົ່ວໄປ'],
      };
      const namedOption = optionList.find((option) => {
        const title = option.title.toLocaleLowerCase();
        return text.includes(title) ||
          (laoProgramAliases[option.title] ?? []).some((alias) => text.includes(alias));
      });
      if (namedOption) return { title: namedOption.title, provider: namedOption.provider };
    }
  }

  // Broad catalog requests are discovery, not program selection. This guard
  // prevents phrases like "ผมสนใจมีโปรแกรมอะไรแนะนำมั้ย" from becoming
  // selectedProgram = the entire question.
  if (isGenericProgramRequest(currentMessage) || isAddonInterestMessage(currentMessage)) return undefined;

  // "สนใจ ..." without a prior catalog option is an interest/topic
  // signal, not a confirmed selection. Let the catalog router show the
  // matching program first; selection becomes explicit after an option list.
  const named = currentMessage.match(/(?:เลือก|เอา|ต้องการ|interested in|choose)\s*["“]?([^"”\n]+?)["”]?(?:\s|$)/iu);
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
  if (isJourneyResetMessage(currentMessage)) {
    return { needs: [], activeNeed: undefined, bookingIntent: false, budgetUnlimited: false };
  }

  let resetIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user' && isJourneyResetMessage(history[i].content)) {
      resetIndex = i;
      break;
    }
  }
  const effectiveHistory = resetIndex >= 0 ? history.slice(resetIndex + 1) : history;
  const userTexts = effectiveHistory.filter((m) => m.role === 'user').map((m) => m.content);
  const allTexts = [...userTexts, currentMessage];
  const lower = allTexts.join('\n').toLowerCase();
  const needs: Array<'health' | 'treatment' | 'transport' | 'hotel' | 'trip'> = [];
  const add = (need: WosJourneyState['needs'][number]) => { if (!needs.includes(need)) needs.push(need); };

  if (/(ตรวจสุขภาพ|สุขภาพ|wellness|health check|ສຸຂະພາບ|ກວດສຸຂະພາບ)/iu.test(lower)) add('health');
  if (/(รักษา|พบแพทย์|หมอ|treatment|doctor|surgery|ຮັກສາ|ໝໍ)/iu.test(lower)) add('treatment');
  if (/(รถ|รับส่ง|transport|transfer|shuttle|ລົດ|ຮັບສົ່ງ)/iu.test(lower)) add('transport');
  if (/(โรงแรม|ที่พัก|hotel|accommodation|room|ໂຮງແຮມ|ທີ່ພັກ)/iu.test(lower)) add('hotel');
  if (/(ไปอุดร|เที่ยว|ทริป|เดินทาง|trip|travel|ທ່ອງທ່ຽວ|ເດີນທາງ)/iu.test(lower)) add('trip');

  const selected = latestSelectedProgram(effectiveHistory, currentMessage);
  const explicitCustomerName = findCustomerName(allTexts);
  const lastAssistantMessage = [...effectiveHistory].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  const bareNamePattern = /^[ก-๙\u0E80-\u0EFFA-Za-z][ก-๙\u0E80-\u0EFFA-Za-z .'-]{1,60}$/u;
  const nameRequestPattern = /(?:ขอชื่อ|ชื่อสำหรับ|what name|name should I use|ຂໍຊື່)/iu;
  let bareCustomerName: string | undefined;
  if (!explicitCustomerName) {
    if (nameRequestPattern.test(lastAssistantMessage) && bareNamePattern.test(currentMessage.trim())) {
      bareCustomerName = currentMessage.trim();
    } else {
      for (let i = effectiveHistory.length - 1; i >= 1; i--) {
        if (effectiveHistory[i].role !== 'user' || !bareNamePattern.test(effectiveHistory[i].content.trim())) continue;
        const previousAssistant = effectiveHistory[i - 1];
        if (previousAssistant?.role === 'assistant' && nameRequestPattern.test(previousAssistant.content)) {
          bareCustomerName = effectiveHistory[i].content.trim();
          break;
        }
      }
    }
  }
  const likelyBareCustomerName = bareCustomerName && !/(?:จอง|booking|book|reserve|ตรวจ|โปรแกรม|บริการ|สนใจ|ต้องการ|เอา|รถ|รถรับส่ง|โรงแรม|ที่พัก|ห้อง|เวียงจันทน์|อุดร|หนองคาย|ขอนแก่น|travel|trip|transport|hotel|ຈອງ|ກວດ|ໂຮງແຮມ|ລົດ|ສົນໃຈ|ຕ້ອງການ)/iu.test(bareCustomerName) ? bareCustomerName : undefined;

  // Fern's own booking summary is durable state evidence. Chatwoot may not
  // provide a usable sender name on every WhatsApp event, so recover the
  // customer name from the summary already shown to the customer before
  // asking for it again.
  let summaryCustomerName: string | undefined;
  for (let i = effectiveHistory.length - 1; i >= 0; i--) {
    const message = effectiveHistory[i];
    if (message.role !== 'assistant') continue;
    const match = message.content.match(/(?:^|\\n)\\s*[•*-]\\s*(?:ชื่อผู้จอง|ຊື່ຜູ້ຈອງ|customer name|name)\\s*:\\s*([^\\n]+)/iu);
    if (match?.[1]?.trim()) {
      summaryCustomerName = match[1].trim();
      break;
    }
  }
  const customerName = explicitCustomerName ?? likelyBareCustomerName ?? summaryCustomerName;
  // Transport V1 does not ask the customer for a drop-off/destination.
  // Keep destination out of the transport intake so a bare location such as
  // "อุดร" cannot accidentally reopen catalog/province routing. WOS Admin
  // will coordinate the remaining transport details after handoff.
  const explicitDestination = findDestination(allTexts);
  const normalizedCurrent = currentMessage.trim().normalize('NFC');
  const selectedProgramDestination = (() => {
    if (!selected?.title) return undefined;
    for (let i = effectiveHistory.length - 1; i >= 0; i--) {
      const message = effectiveHistory[i];
      if (message.role !== 'assistant' || !message.content.includes(selected.title)) continue;
      const province = findProvince([message.content]);
      if (province) return province;
    }
    return undefined;
  })();
  const destination = explicitDestination
    ?? selectedProgramDestination
    ?? findProvince(allTexts);
  const barePickupAliases = new Set([
    '\u0E40\u0E27\u0E35\u0E22\u0E07\u0E08\u0E31\u0E19',
    '\u0E40\u0E27\u0E35\u0E22\u0E07\u0E08\u0E31\u0E19\u0E17\u0E19\u0E4C',
    '\u0E40\u0E27\u0E35\u0E22\u0E07\u0E08\u0E31\u0E19\u0E17\u0E19',
    'Vientiane', 'vientiane',
  ]);
  const lastUserMessageIsBareLocation = LOCATION_ALIASES[currentMessage.trim()] !== undefined || barePickupAliases.has(normalizedCurrent);
  // Unambiguous pickup aliases are captured directly once the customer answers the pickup question.
  const historicalBarePickup = (() => {
    for (let i = effectiveHistory.length - 2; i >= 0; i--) {
      const assistant = effectiveHistory[i];
      const user = effectiveHistory[i + 1];
      if (assistant?.role !== 'assistant' || user?.role !== 'user') continue;
      if (!/(?:จุดรับ|รับที่|รับจาก|pickup|pick-up|ຈຸດຮັບ)/iu.test(assistant.content)) continue;
      const value = user.content.trim().normalize('NFC');
      // A pickup answer does not need to match a location dictionary.
      // Preserve exactly what the customer supplied (after light cleanup).
      if (value.length >= 2 && !/^(?:ไม่|ไม่ต้องการ|ไม่เอา|no|none|ບໍ່|ບໍ່ຕ້ອງການ)$/iu.test(value)) {
        return normalizeLocation(value);
      }
    }
    return undefined;
  })();
  // Laos pickup points are intentionally open-ended. WOS can arrange pickup
  // throughout Laos, so a customer-provided place must be stored even when
  // Fern does not know that place name or province. Only capture an arbitrary
  // bare answer when the immediately preceding assistant turn was asking for
  // the pickup point; never turn unrelated free text into a pickup location.
  const lastAssistantAskedPickup = /(?:จุดรับ|รับที่|รับจาก|pickup|pick-up|ຈຸດຮັບ|ຮັບຢູ່|ຮັບຈາກ)/iu.test(lastAssistantMessage);
  // Some chat transports trim or omit the immediately preceding assistant turn.
  // Once the customer has already said they want transport, the next
  // non-affirmative/non-negative free-text reply is the pickup point.
  const transportAffirmedInHistory = (() => {
    for (let i = effectiveHistory.length - 2; i >= 0; i--) {
      const assistant = effectiveHistory[i];
      const user = effectiveHistory[i + 1];
      if (assistant?.role !== 'assistant' || user?.role !== 'user') continue;
      if (!/^(?:สนใจ|ต้องการ|เอา|ขอ|ใช่|yes|y|ok|okay|interested|ສົນໃຈ|ຕ້ອງການ|ເອົາ|ແມ່ນ)(?:ครับ|ค่ะ|คะ|ครับผม)?$/iu.test(user.content.trim())) continue;
      if (/(?:รถ|รถรับส่ง|transport|transfer|shuttle|ລົດ|ຮັບສົ່ງ)/iu.test(assistant.content)) return true;
    }
    return false;
  })();
  const pickupCollectionActive = lastAssistantAskedPickup || transportAffirmedInHistory;
  const arbitraryPickupAnswer = pickupCollectionActive
    && currentMessage.trim().length >= 2
    && !/^(?:สนใจ|ต้องการ|เอา|ขอ|ใช่|ไม่|ไม่ต้องการ|ไม่เอา|ไม่สนใจ|yes|y|ok|okay|interested|no|none|ບໍ່|ບໍ່ຕ້ອງການ)$/iu.test(currentMessage.trim())
    ? normalizeLocation(currentMessage)
    : undefined;
  const inferredBarePickup = lastUserMessageIsBareLocation
    ? normalizeLocation(currentMessage)
    : historicalBarePickup ?? arbitraryPickupAnswer;
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
  // Short affirmative/negative replies inherit the optional-service question Fern just asked.
  const lastAssistantForAddon = [...effectiveHistory].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  const shortAffirmative = /^(?:สนใจ|ต้องการ|เอา|ขอ|ใช่|yes|y|ok|okay|interested|ສົນໃຈ|ຕ້ອງການ|ເອົາ|ແມ່ນ)(?:ครับ|ค่ะ|คะ|ครับผม)?$/iu.test(currentMessage.trim());
  const shortNegative = /^(?:ไม่|ไม่เอา|ไม่ต้องการ|ไม่สนใจ|no|n|none|not interested|ບໍ່|ບໍ່ເອົາ|ບໍ່ຕ້ອງການ|ບໍ່ສົນໃຈ)(?:ครับ|ค่ะ|คะ|ครับผม)?$/iu.test(currentMessage.trim());
  const assistantAskedTransport = /(?:รถ|รถรับส่ง|transport|transfer|shuttle|ລົດ|ຮັບສົ່ງ|ລົດຮັບສົ່ງ|ລົດສົ່ງ|ລົດຮັບ)/iu.test(lastAssistantForAddon);
  const shortTransportAffirmation = shortAffirmative && assistantAskedTransport;
  const assistantAskedHotel = /(?:(?:สนใจ|ສົນໃຈ|ຕ້ອງການ).*?(?:โรงแรม|ที่พัก|ห้องพัก|hotel|room|ໂຮງແຮມ|ທີ່ພັກ)|(?:โรงแรม|ที่พัก|ห้องพัก|hotel|room|ໂຮງແຮມ|ທີ່ພັກ).*?(?:สนใจ|want|need|interested|ສົນໃຈ|ຕ້ອງການ))/iu.test(lastAssistantForAddon);

  // Do not apply a bare "ไม่ต้องการ" to both optional services. A short
  // negative belongs only to the addon Fern just asked about; otherwise a
  // hotel rejection can accidentally erase an already-captured transport request.
  const derivedTransportNeeded = findPreference(allTexts, /(?:ต้องการ|เอา|ขอ|สนใจ|ຕ້ອງການ|ເອົາ|ຂໍ|ສົນໃຈ).*?(?:รถ|รถรับส่ง|ລົດ|ຮັບສົ່ງ)|(?:need|want|interested).*?(?:transport|transfer)/iu, /(?:ไม่ต้องการ|ไม่เอา|ไม่ขอ|ບໍ່ຕ້ອງການ|ບໍ່ເອົາ|ບໍ່ຂໍ).*?(?:รถ|รถรับส่ง|ລົດ|ຮັບສົ່ງ)|(?:don't|do not|no).*?(?:transport|transfer)/iu);
  const derivedHotelNeeded = findPreference(allTexts, /(?:ต้องการ|เอา|ขอ|สนใจ|ຕ້ອງການ|ເອົາ|ຂໍ|ສົນໃຈ).*?(?:โรงแรม|ที่พัก|ห้องพัก|ໂຮງແຮມ|ທີ່ພັກ)|(?:need|want|interested).*?(?:hotel|room)/iu, /(?:ไม่ต้องการ|ไม่เอา|ไม่ขอ|ບໍ່ຕ້ອງການ|ບໍ່ເອົາ|ບໍ່ຂໍ).*?(?:โรงแรม|ที่พัก|ห้องพัก|ໂຮງແຮມ|ທີ່ພັກ)|(?:don't|do not|no).*?(?:hotel|room)/iu);

  // Short affirmations are state transitions. Preserve the affirmative fact
  // on the following turn (for example, the pickup-point message), because
  // derivedTransportNeeded only sees user text and the word "สนใจ" alone does
  // not contain the transport noun.
  let historicalTransportNeeded: boolean | undefined;
  let historicalHotelNeeded: boolean | undefined;
  for (let i = effectiveHistory.length - 2; i >= 0; i--) {
    const assistant = effectiveHistory[i];
    const user = effectiveHistory[i + 1];
    if (assistant?.role !== 'assistant' || user?.role !== 'user') continue;
    const userText = user.content.trim();
    if (/^(?:สนใจ|ต้องการ|เอา|ขอ|yes|y|ok|okay|interested|ສົນໃຈ|ຕ້ອງການ|ເອົາ|ຂໍ)(?:ครับ|ค่ะ|คะ|ครับผม)?$/iu.test(userText)) {
      if (/(?:รถ|รถรับส่ง|transport|transfer|shuttle|ລົດ|ຮັບສົ່ງ|ລົດຮັບສົ່ງ)/iu.test(assistant.content)) {
        historicalTransportNeeded = true;
      }
      if (/(?:โรงแรม|ที่พัก|ห้องพัก|hotel|room|accommodation|ໂຮງແຮມ|ທີ່ພັກ)/iu.test(assistant.content)) {
        historicalHotelNeeded = true;
      }
    }
  }

  const shortHotelAffirmation = shortAffirmative && assistantAskedHotel;
  const shortHotelRejection = shortNegative && assistantAskedHotel;
  const shortTransportRejection = shortNegative && assistantAskedTransport;

  return {
    destination,
    // A bare location is a valid pickup point when Fern just asked for it.
    // Keep it in the shared origin field too so every concierge guard sees the captured fact.
    origin: findOrigin(allTexts) ?? inferredBarePickup,
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
    transportOrigin: findOrigin(allTexts) ?? inferredBarePickup,
    transportDestination: undefined,
    transportDestinationSource: undefined,
    hotelTravelers: findHotelTravelers(allTexts) ?? findTravelers(allTexts) ?? (/(?:โรงแรม|ที่พัก|ห้องพัก|hotel|room)/iu.test(currentMessage) ? findTravelers([currentMessage]) : undefined),
    hotelRooms: findRooms(allTexts),
    transportNeeded: shortTransportAffirmation ? true : shortTransportRejection ? false : derivedTransportNeeded ?? historicalTransportNeeded,
    hotelNeeded: shortHotelAffirmation ? true : shortHotelRejection ? false : derivedHotelNeeded ?? historicalHotelNeeded,
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
