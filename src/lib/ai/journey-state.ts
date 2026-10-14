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
  /**
   * The single optional-service question Fern's immediately preceding turn was
   * waiting on. Short replies ("สนใจ", "ไม่เอา") may only ever bind to this.
   */
  pendingQuestion?: WosAddonQuestion;
  /**
   * Which pending question the CURRENT customer message actually answered
   * (undefined when it answered nothing, e.g. "ขอบคุณ").
   */
  answeredQuestion?: WosAddonQuestion;
};

export type WosAddonQuestion = 'name' | 'transport' | 'pickup' | 'hotel';

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

  // If Fern just showed one concrete program in detail, a short affirmative
  // ("สนใจครับ", "สนใจค่ะ", "ສົນໃຈ") means the customer accepted that
  // specific program. Treat it as an explicit selection, not a new catalog
  // discovery request.
  // A bare "สนใจ" that answers a transport / pickup / hotel question is an answer
  // to THAT question. It must never be re-read as "select the first program from
  // an older catalog message".
  const lastHistoryMessage = history[history.length - 1];
  const pendingAddonQuestion = lastHistoryMessage?.role === 'assistant'
    ? classifyAssistantQuestion(lastHistoryMessage.content)
    : undefined;
  const bareSelectionAffirmative = !pendingAddonQuestion && /^(?:สนใจ|ต้องการ|เอา|ขอ|ใช่|yes|y|ok|okay|interested|ສົນໃຈ|ຕ້ອງການ|ເອົາ|ແມ່ນ)(?:ครับ|ค่ะ|คะ|ครับผม)?$/iu.test(currentMessage.trim());
  if (bareSelectionAffirmative) {
    const latestConcreteProgram = [...optionMessages].reverse().find((message) =>
      /(?:ราคาโปรโมชั่น|ราคาปกติ|ระยะเวลา|provider|ผู้ให้บริการ|ລາຄາ|ໄລຍະເວລາ)/iu.test(message.content) &&
      /(?:^|\n)\s*(?:\d+[.)]\s*)?[^\n]{2,80}?\s+(?:—|-)\s+/u.test(message.content)
    );
    if (latestConcreteProgram) {
      const firstProgramLine = latestConcreteProgram.content
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /.+?\s+(?:—|-)\s+/u.test(line));
      if (firstProgramLine) {
        const title = firstProgramLine
          .replace(/^\d+[.)]\s*/u, '')
          .split(/\s+[—-]\s+/)[0]
          .trim();
        if (title && !/(?:ถ้าสนใจ|บอกใบเฟิร์น|ราคา|ระยะเวลา)/iu.test(title)) {
          return { title };
        }
      }
    }
  }

  // Persist the same selection across the next turn (usually the customer's name).
  // Example: detail -> "สนใจครับ" -> "Vith Hub" must keep the detail's program.
  for (let i = history.length - 1; i >= 1; i--) {
    const priorUser = history[i];
    const priorAssistant = history[i - 1];
    if (priorUser.role !== 'user' || priorAssistant.role !== 'assistant') continue;
    if (classifyAssistantQuestion(priorAssistant.content)) continue;
    if (!/^(?:สนใจ|ต้องการ|เอา|ขอ|ใช่|yes|y|ok|okay|interested|ສົນໃຈ|ຕ້ອງການ|ເອົາ|ແມ່ນ)(?:ครับ|ค่ะ|คะ|ครับผม)?$/iu.test(priorUser.content.trim())) continue;
    if (!/(?:ราคาโปรโมชั่น|ราคาปกติ|ระยะเวลา|provider|ผู้ให้บริการ|ລາຄາ|ໄລຍະເວລາ)/iu.test(priorAssistant.content)) continue;
    const match = priorAssistant.content.match(/[0-9]+[.)] +(.+?) (?:—|-|–) /u);
    const title = match?.[1]?.trim();
    if (title) return { title };
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

  // A bare affirmative ("สนใจ", "เอา", "ใช่") carries no program name, so it
  // must keep the program the customer already chose by name earlier
  // ("เลือกตรวจเข่า"). Walk back to the latest explicit "เลือก/เอา/ต้องการ X"
  // user turn, stop at a journey reset, and never re-read the affirmative as
  // a new catalog discovery request.
  if (/^(?:สนใจ|ต้องการ|เอา|ขอ|ใช่|yes|y|ok|okay|interested|ສົນໃຈ|ຕ້ອງການ|ເອົາ|ແມ່ນ)(?:ครับ|ค่ะ|คะ|ครับผม)?$/iu.test(currentMessage.trim())) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role !== 'user') continue;
      if (isJourneyResetMessage(history[i].content)) break;
      const prior = history[i].content.trim().match(/^(?:เลือก|เอา|ต้องการ)\s*["“]?([^"”\n]+?)["”]?$/iu);
      const title = prior?.[1]?.trim();
      if (title && !/^(?:รายการนี้|ตัวนี้|อันนี้|this one|this item)$/iu.test(title) && !/^\d{1,2}[.)]?$/.test(title) &&
        !/(?:รถ|โรงแรม|ที่พัก|ห้องพัก|hotel|transport|transfer|shuttle|ລົດ|ໂຮງແຮມ)/iu.test(title)) {
        return { title };
      }
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

// ---------------------------------------------------------------------------
// Optional-service (transport / pickup / hotel) state machine
//
// Rule: a customer reply is interpreted against the ONE question Fern asked in
// the immediately preceding turn. History is replayed turn by turn, so a short
// answer can change exactly one slot, and unrelated turns ("ขอบคุณ") change
// nothing. Nothing here scans the whole transcript for keywords.
// ---------------------------------------------------------------------------

type AddonSlots = {
  transportNeeded?: boolean;
  transportOrigin?: string;
  hotelNeeded?: boolean;
};

const TRANSPORT_NOUN = '(?:รถรับส่ง|รถ|ລົດຮັບສົ່ງ|ລົດ|ຮັບສົ່ງ|transportation|transport|transfer|shuttle)';
const HOTEL_NOUN = '(?:โรงแรม|ที่พัก|ห้องพัก|ໂຮງແຮມ|ທີ່ພັກ|ຫ້ອງພັກ|accommodation|hotel|room)';
const ANY_SERVICE_NOUN = `(?:${TRANSPORT_NOUN}|${HOTEL_NOUN})`;
const WANT_WORD = '(?:สนใจ|ต้องการ|อยากได้|เอา|ขอ|ຕ້ອງການ|ເອົາ|ຂໍ|ສົນໃຈ)';
const WANT_GAP = '(?:จอง|ใช้|เช่า|บริการ|ให้ช่วยจัด|ให้จัด|จัด)?';
const SERVICE_JOIN = '(?:และ|กับ|หรือ|พร้อม|ด้วย|,|/)?';

function buildAskPattern(noun: string): RegExp {
  return new RegExp(
    `(?:สนใจ|ต้องการ|อยากได้|ຕ້ອງການ|ສົນໃຈ)\\s*(?:ให้\\s*)?(?:บริการ\\s*)?${noun}` +
    `|${noun}[^\\s?？]{0,8}\\s*(?:ไหม|มั้ย|หรือเปล่า|หรือไม่|ບໍ)` +
    `|(?:would\\s+you\\s+like|do\\s+you\\s+want|do\\s+you\\s+need|are\\s+you\\s+interested\\s+in)[^.?!\\n]{0,24}?${noun}`,
    'iu',
  );
}

const TRANSPORT_ASK = buildAskPattern(TRANSPORT_NOUN);
const HOTEL_ASK = buildAskPattern(HOTEL_NOUN);
const PICKUP_ASK = /(?:ขอ|ช่วยแจ้ง|รบกวนแจ้ง|รบกวนระบุ|ระบุ)\s*(?:ทราบ\s*)?(?:จุดรับ|สถานที่รับ)|จุดรับ\s*(?:อยู่)?(?:ที่ไหน|คือที่ไหน|คืออะไร)|(?:what|where)(?:\s+is|'s)?\s+(?:the\s+|your\s+)?pick-?up|ຂໍຈຸດຮັບ|ຈຸດຮັບ[^\n]{0,8}(?:ບ່ອນໃດ|ຢູ່ໃສ)/iu;
const NAME_ASK = /(?:ขอชื่อ|ชื่อสำหรับ|what name|name should I use|ຂໍຊື່)/iu;

function lastMatchSpan(pattern: RegExp, text: string): { start: number; end: number } | undefined {
  let span: { start: number; end: number } | undefined;
  for (const match of text.matchAll(new RegExp(pattern.source, 'giu'))) {
    const start = match.index ?? 0;
    span = { start, end: start + match[0].length };
  }
  return span;
}

/**
 * Which single question does this assistant message leave open?
 *
 * The question that comes LAST in the message is the one the customer is
 * answering; earlier mentions ("ถ้าต้องการที่พักก็มีโรงแรมใกล้คลินิกค่ะ ...
 * สนใจรถรับส่งด้วยไหมคะ?") are just context. A single sentence that asks about
 * BOTH transport and hotel ("สนใจรถรับส่งหรือโรงแรมเพิ่มไหมคะ?") is ambiguous:
 * one bare "สนใจ" cannot settle two questions, so it resolves to undefined and
 * Fern asks one question at a time.
 */
export function classifyAssistantQuestion(text: string): WosAddonQuestion | undefined {
  if (!text) return undefined;
  const candidates = ([
    ['transport', TRANSPORT_ASK],
    ['hotel', HOTEL_ASK],
    ['pickup', PICKUP_ASK],
    ['name', NAME_ASK],
  ] as const)
    .map(([type, pattern]) => ({ type, span: lastMatchSpan(pattern, text) }))
    .filter((c): c is { type: WosAddonQuestion; span: { start: number; end: number } } => Boolean(c.span))
    .sort((a, b) => b.span.start - a.span.start);
  if (candidates.length === 0) return undefined;

  const [last, ...rest] = candidates;
  if (last.type === 'transport' || last.type === 'hotel') {
    const other = last.type === 'transport' ? 'hotel' : 'transport';
    const sibling = rest.find((c) => c.type === other);
    if (sibling) {
      const between = text.slice(Math.min(sibling.span.end, last.span.start), last.span.start);
      const sameQuestion = last.span.start - sibling.span.end <= 20 && !/[?？!\n。]/u.test(between);
      if (sameQuestion) return undefined;
    }
  }
  return last.type;
}

const POLITE_TAIL = '(?:\\s*(?:ครับผม|ครับ|คับ|ค่ะ|คะ|นะครับ|นะคะ|นะค่ะ|นะ|เลย|ด้วย|ແດ່|ຄ່ະ|ຄັບ|ເດີ|ເລີຍ))*';
const AFFIRM_WORDS = '(?:สนใจ(?:มาก)?|ต้องการ|เอาด้วย|เอา|ขอ|ใช่|ได้เลย|ได้|โอเค|ตกลง|yes|yeah|yep|yup|sure|ok|okay|interested|y|ສົນໃຈ|ຕ້ອງການ|ເອົາ|ແມ່ນ|ໄດ້|ຕົກລົງ)';
const NEGATIVE_WORDS = '(?:ไม่ต้องการ|ไม่สนใจ|ไม่เอา|ไม่ต้อง|ยังไม่ต้องการ|ยังไม่เอา|ยังไม่|ไม่(?:ล่ะ|ละ|หรอก|เป็นไร)?|not interested|no thanks|no thank you|nope|nah|none|no|n|ບໍ່ຕ້ອງການ|ບໍ່ສົນໃຈ|ບໍ່ເອົາ|ບໍ່)';
const AFFIRM_RE = new RegExp(`^${AFFIRM_WORDS}${POLITE_TAIL}$`, 'iu');
const NEGATIVE_RE = new RegExp(`^${NEGATIVE_WORDS}${POLITE_TAIL}(?:\\s*ขอบคุณ${POLITE_TAIL})?$`, 'iu');

const PURE_ACK_RE = new RegExp(`^(?:อืม|อ๋อ|อ่อ|เออ|หืม|5{2,}|รับทราบ|เข้าใจแล้ว|เข้าใจ)?${POLITE_TAIL}$`, 'iu');

function normalizeShortReply(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, ' ')
    .replace(/[\s!?.,。~…]+/gu, ' ')
    .trim();
}

export function isShortAffirmative(text: string): boolean {
  return AFFIRM_RE.test(normalizeShortReply(text));
}

export function isShortNegative(text: string): boolean {
  return NEGATIVE_RE.test(normalizeShortReply(text));
}

export function isThanksMessage(text: string): boolean {
  return /^(?:thanks|thank you|thx|ขอบคุณ(?:มาก)?(?:ครับ|ค่ะ)?|ຂອບໃຈ(?:ຫຼາຍ)?)[\s!?.]*$/iu.test(text.trim());
}

/**
 * An explicit statement that NAMES the service ("สนใจรถรับส่ง", "ไม่เอาโรงแรม").
 * Unlike a bare "สนใจ", this is self-describing, so it is valid whichever
 * question is pending. The noun must sit right next to the verb; a distant
 * noun elsewhere in the sentence does not count.
 */
function explicitServicePreference(text: string, noun: string): boolean | undefined {
  const reach = `\\s*${WANT_GAP}\\s*(?:${ANY_SERVICE_NOUN}\\s*${SERVICE_JOIN}\\s*)*?${noun}`;
  const negative = new RegExp(
    `(?:ไม่|ยังไม่|ບໍ່)\\s*(?:ต้องการ|เอา|ขอ|สนใจ|ใช้|ຕ້ອງການ|ເອົາ|ສົນໃຈ)${reach}` +
    `|(?:don't|do not)\\s+(?:need|want)\\s+(?:a\\s+|any\\s+)?${noun}|\\bno\\s+(?:need\\s+for\\s+)?(?:a\\s+)?${noun}`,
    'iu',
  );
  if (negative.test(text)) return false;
  const positive = new RegExp(
    `(?<!ไม่|ບໍ່)${WANT_WORD}${reach}|(?:need|want|interested\\s+in)\\s+(?:a\\s+)?${noun}`,
    'iu',
  );
  return positive.test(text) ? true : undefined;
}

const PICKUP_PHRASE = /(?:รับที่|รับจาก|จุดรับ(?:คือ|อยู่ที่|ที่)?|สถานที่รับ(?:คือ)?|pick-?up(?:\s+point)?(?:\s+(?:is|at))?|ຈຸດຮັບ(?:ແມ່ນ|ຢູ່)?|ຮັບຢູ່|ຮັບຈາກ)\s*[:：]?\s*([^\n,]{1,80})/iu;

/** Explicit "pickup at X" wording. Implies the customer wants transport. */
function extractExplicitPickup(text: string): string | undefined {
  const known = text.match(/(?:รับที่|รับจาก|จุดรับ|pickup)\s*(เวียงจัน(?:ทน์)?|เวียงจันทน์|อุดรธานี|หนองคาย|ขอนแก่น|กรุงเทพมหานคร|ວຽງຈັນ)/iu);
  if (known?.[1]) return normalizeLocation(known[1]);
  const captured = text.match(PICKUP_PHRASE)?.[1]?.trim();
  if (!captured) return undefined;
  const trimmed = captured.split(/\s+(?=\d|วันที่|เวลา|ไป\S|ถึง|พร้อม|และ|ครับ|ค่ะ|คะ)/u)[0]?.trim();
  return trimmed ? normalizeLocation(trimmed) : undefined;
}

const NOT_A_PLACE = /(?:ไหม|มั้ย|หรือเปล่า|เท่าไร|เท่าไหร่|กี่|ราคา|อะไร|ยังไง|อย่างไร|ที่ไหน|ເທົ່າໃດ|ບໍ\s*$|\b(?:how|what|why|when|where|price|cost)\b)|^(?:ไม่ทราบ|ไม่รู้|ยังไม่แน่ใจ|ไม่แน่ใจ|ยังไม่ทราบ|ບໍ່ຮູ້|ບໍ່ແນ່ໃຈ|not sure|don't know)/iu;

/**
 * Laos pickup points are open-ended, so almost any short free text answers the
 * pickup question. Acknowledgements, thanks, resets, refusals and questions do not.
 */
function looksLikePickupAnswer(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 120) return false;
  if (isShortAffirmative(t) || isShortNegative(t)) return false;
  if (isThanksMessage(t) || isJourneyResetMessage(t)) return false;
  if (PURE_ACK_RE.test(normalizeShortReply(t))) return false;
  if (/[?？]\s*$/u.test(t) || NOT_A_PLACE.test(t)) return false;
  if (isGenericProgramRequest(t)) return false;
  return true;
}

// Fern's own booking summary is durable evidence, like name/program recovery.
// It lets the state survive once the original turns fall out of the history window.
function parseSummarySlots(text: string): AddonSlots | undefined {
  const line = (labels: string) => text.match(new RegExp(`(?:^|\\n)\\s*[•*-]\\s*(?:${labels})\\s*:\\s*([^\\n]+)`, 'iu'))?.[1]?.trim();
  const polarity = (value: string | undefined): boolean | undefined => {
    if (!value) return undefined;
    if (/^(?:ไม่|ບໍ່|not\s)/iu.test(value)) return false;
    if (/^(?:ต้องการ|ຕ້ອງການ|needed)/iu.test(value)) return true;
    return undefined;
  };
  const transport = polarity(line('รถรับส่ง|ລົດຮັບສົ່ງ|transport'));
  const hotel = polarity(line('โรงแรม|ໂຮງແຮມ|hotel'));
  const pickup = line('จุดรับ|ຈຸດຮັບ|pickup');
  if (transport === undefined && hotel === undefined && !pickup) return undefined;
  const slots: AddonSlots = {};
  if (transport !== undefined) slots.transportNeeded = transport;
  if (hotel !== undefined) slots.hotelNeeded = hotel;
  if (pickup && transport !== false) slots.transportOrigin = pickup;
  return slots;
}

function applyAddonTurn(
  slots: AddonSlots,
  question: WosAddonQuestion | undefined,
  rawAnswer: string,
): { slots: AddonSlots; answered?: WosAddonQuestion } {
  const answer = rawAnswer.trim();
  const next: AddonSlots = { ...slots };
  let answered: WosAddonQuestion | undefined;

  const declineTransport = () => {
    next.transportNeeded = false;
    next.transportOrigin = undefined;
  };

  // 1. Self-describing statements are valid at any time and touch only the service they name.
  const transportExplicit = explicitServicePreference(answer, TRANSPORT_NOUN);
  const hotelExplicit = explicitServicePreference(answer, HOTEL_NOUN);
  if (transportExplicit === true) next.transportNeeded = true;
  if (transportExplicit === false) declineTransport();
  if (hotelExplicit !== undefined) next.hotelNeeded = hotelExplicit;
  if (question === 'transport' && transportExplicit !== undefined) answered = 'transport';
  if (question === 'hotel' && hotelExplicit !== undefined) answered = 'hotel';

  // 2. A short or free-text reply binds ONLY to the question that was just asked.
  if (question === 'transport' && transportExplicit === undefined) {
    if (isShortAffirmative(answer)) { next.transportNeeded = true; answered = 'transport'; }
    else if (isShortNegative(answer)) { declineTransport(); answered = 'transport'; }
  } else if (question === 'hotel' && hotelExplicit === undefined) {
    if (isShortAffirmative(answer)) { next.hotelNeeded = true; answered = 'hotel'; }
    else if (isShortNegative(answer)) { next.hotelNeeded = false; answered = 'hotel'; }
  } else if (question === 'pickup' && transportExplicit === undefined) {
    if (isShortNegative(answer)) {
      declineTransport();
      answered = 'transport';
    } else if (!extractExplicitPickup(answer) && looksLikePickupAnswer(answer)) {
      next.transportNeeded = true;
      next.transportOrigin = normalizeLocation(answer);
      answered = 'pickup';
    }
  }

  // 3. Explicit pickup wording ("รับที่…") implies transport unless the customer declined it.
  const explicitPickup = extractExplicitPickup(answer);
  if (explicitPickup && next.transportNeeded !== false) {
    next.transportNeeded = true;
    next.transportOrigin = explicitPickup;
    if (question === 'pickup' || question === 'transport') answered = answered ?? 'pickup';
  } else if (next.transportNeeded === true) {
    // "จาก X" is only a pickup point once the customer has asked for transport.
    const fromPlace = findOrigin([answer]);
    if (fromPlace) {
      next.transportOrigin = fromPlace;
      if (question === 'pickup') answered = 'pickup';
    }
  }

  return { slots: next, answered };
}

function deriveAddonState(history: WosAIHistoryMessage[], currentMessage: string): AddonSlots & {
  pendingQuestion?: WosAddonQuestion;
  answeredQuestion?: WosAddonQuestion;
} {
  const messages: WosAIHistoryMessage[] = [...history, { role: 'user', content: currentMessage }];
  let slots: AddonSlots = {};
  let answeredQuestion: WosAddonQuestion | undefined;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === 'assistant') {
      const seeded = parseSummarySlots(message.content);
      if (seeded) slots = { ...slots, ...seeded };
      continue;
    }
    const previous = messages[i - 1];
    const question = previous?.role === 'assistant' ? classifyAssistantQuestion(previous.content) : undefined;
    const result = applyAddonTurn(slots, question, message.content);
    slots = result.slots;
    if (i === messages.length - 1) answeredQuestion = result.answered;
  }

  const lastHistory = history[history.length - 1];
  const pendingQuestion = lastHistory?.role === 'assistant' ? classifyAssistantQuestion(lastHistory.content) : undefined;
  return { ...slots, pendingQuestion, answeredQuestion };
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
    const match = message.content.match(/(?:^|\n)\s*[•*-]\s*(?:ชื่อผู้จอง|ຊື່ຜູ້ຈອງ|customer name|name)\s*:\s*([^\n]+)/iu);
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

  // Transport / pickup / hotel are decided turn by turn against the question
  // Fern just asked. See the add-on state machine above.
  const addon = deriveAddonState(effectiveHistory, currentMessage);

  return {
    destination,
    // A bare location is a valid pickup point when Fern just asked for it.
    // Keep it in the shared origin field too so every concierge guard sees the captured fact.
    origin: findOrigin(allTexts) ?? (lastUserMessageIsBareLocation ? normalizeLocation(currentMessage) : undefined) ?? addon.transportOrigin,
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
    // Pickup comes only from the pickup answer (or explicit pickup wording after
    // transport was requested), never from a stray place name earlier in the chat.
    transportOrigin: addon.transportOrigin,
    transportDestination: undefined,
    transportDestinationSource: undefined,
    hotelTravelers: findHotelTravelers(allTexts) ?? findTravelers(allTexts) ?? (/(?:โรงแรม|ที่พัก|ห้องพัก|hotel|room)/iu.test(currentMessage) ? findTravelers([currentMessage]) : undefined),
    hotelRooms: findRooms(allTexts),
    transportNeeded: addon.transportNeeded,
    hotelNeeded: addon.hotelNeeded,
    pendingQuestion: addon.pendingQuestion,
    answeredQuestion: addon.answeredQuestion,
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
