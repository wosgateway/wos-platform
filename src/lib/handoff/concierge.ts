import type { WosLanguage } from '@/lib/ai/language-dictionary';
import type { WosJourneyState } from '@/lib/ai/journey-state';

export type ChatwootSender = {
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
};

export function detectHandoffLanguage(text: string): WosLanguage {
  if (/[຀-໿]/u.test(text)) return 'lo';
  if (/\b(the|and|with|from|please|yes|confirm)\b/iu.test(text)) return 'en';
  return 'th';
}

export function isHandoffConfirmation(text: string): boolean {
  if (/(?:ไม่ใช่|ยังไม่|not yet|don't|do not)/iu.test(text)) return false;
  return /(?:yes|y|ok|okay|confirm|confirmed|correct|ใช่|ถูกต้อง|ยืนยัน|ตกลง|โอเค|ได้เลย)/iu.test(text);
}

export function extractContact(sender: ChatwootSender | undefined, text: string): {
  name: string;
  channel: 'phone' | 'email';
  value: string;
} | null {
  const name = String(sender?.name ?? '').trim();
  const email = String(sender?.email ?? '').trim();
  const phone = String(sender?.phone_number ?? '').trim();
  const textName = text.match(/(?:ชื่อนาย|ชื่อนางสาว|ชื่อนาง|ชื่อ|ผมชื่อ|ฉันชื่อ|ดิฉันชื่อ)\s*([ก-๙A-Za-z]+)/iu)?.[1]?.trim();
  const resolvedName = name || textName || '';
  if (phone) return { name: resolvedName, channel: 'phone', value: phone };
  if (email) return { name: resolvedName, channel: 'email', value: email };
  const emailInText = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0];
  if (emailInText) return { name: resolvedName, channel: 'email', value: emailInText };
  const phoneInText = text.match(/(?:\+66|0)[\s.-]?(?:\d[\s.-]?){8,10}\d/u)?.[0];
  if (phoneInText) return { name: resolvedName, channel: 'phone', value: phoneInText };
  return null;
}

export function isJourneyReady(state: WosJourneyState): boolean {
  if (!state.needs.length) return false;
  if (state.activeNeed === 'trip' || state.needs.includes('trip')) {
    return Boolean(
      state.destination &&
      state.serviceDate &&
      state.travelers &&
      (state.budgetThb || state.budgetUnlimited)
    );
  }
  return Boolean(state.destination || state.selectedProgram) &&
    Boolean(state.travelers || state.serviceDate);
}

export function buildBookingReviewPrompt(language: WosLanguage, state: WosJourneyState, contactName?: string): string {
  const lines = [
    state.selectedProgram ? `โปรแกรม: ${state.selectedProgram}` : '',
    state.selectedProvider ? `ผู้ให้บริการ: ${state.selectedProvider}` : '',
    state.destination ? `สถานที่: ${state.destination}` : '',
    state.serviceDate ? `วันที่: ${state.serviceDate}` : '',
    state.serviceTime ? `เวลา: ${state.serviceTime}` : '',
    state.travelers ? `จำนวน: ${state.travelers} คน` : '',
    contactName ? `ชื่อผู้จอง: ${contactName}` : '',
  ].filter(Boolean);

  if (language === 'lo') {
    const laoLines = lines.map((line) => line
      .replace(/^โปรแกรม:/, 'ໂປຣແກຣມ:')
      .replace(/^ผู้ให้บริการ:/, 'ຜູ້ໃຫ້ບໍລິການ:')
      .replace(/^สถานที่:/, 'ສະຖານທີ່:')
      .replace(/^วันที่:/, 'ວັນທີ:')
      .replace(/^เวลา:/, 'ເວລາ:')
      .replace(/^จำนวน:/, 'ຈຳນວນ:')
      .replace(/^ชื่อผู้จอง:/, 'ຊື່ຜູ້ຈອງ:'));
    return `ຂໍສະຫຼຸບກ່ອນດຳເນີນການຈອງນະຄ່ະ 😊\n\n${laoLines.map((x) => `• ${x}`).join('\n')}\n\nຖ້າຂໍ້ມູນຖືກຕ້ອງ ຕອບ “ຢືນຢັນ” ໄດ້ເລີຍຄ່ະ. ຫຼັງຈາກຢືນຢັນ ໃບເຟີນຈະປະສານທີມ WOS ໃຫ້ດຳເນີນການຈອງ ແລະຕິດຕໍ່ກັບທ່ານອີກຄັ້ງ.`;
  }
  if (language === 'en') {
    return `Let me summarize the booking request first 😊\n\n${lines.map((x) => `• ${x}`).join('\n')}\n\nIf everything is correct, reply “confirm”. After confirmation, Fern will coordinate with the WOS team to proceed with the booking, and the team will contact you again to confirm the final details.`;
  }
  return `ขอสรุปข้อมูลก่อนดำเนินการจองนะคะ 😊\n\n${lines.map((x) => `• ${x}`).join('\n')}\n\nถ้าข้อมูลถูกต้อง ตอบ “ยืนยัน” ได้เลยค่ะ หลังจากยืนยัน ใบเฟิร์นจะแจ้งประสานทีม WOS ให้ดำเนินการจองต่อ และทีมงานจะติดต่อกลับเพื่อยืนยันรายละเอียดอีกครั้งค่ะ`;
}

export function buildHandoffConfirmation(language: WosLanguage): string {
  if (language === 'lo') {
    return 'ສະຫຼຸບຂໍ້ມູນໃຫ້ແລ້ວ 😊 ຖ້າລາຍລະອຽດຖືກຕ້ອງ ຕອບ “ຢືນຢັນ” ໄດ້ເລີຍ.';
  }
  if (language === 'en') {
    return 'I have the request details ready 😊 If everything is correct, reply “confirm”.';
  }
  return 'สรุปข้อมูลให้แล้วนะคะ 😊 ถ้ารายละเอียดถูกต้อง ตอบ “ยืนยัน” ได้เลยค่ะ';
}

export function buildServiceOptionsPrompt(language: WosLanguage, state: WosJourneyState): string {
  const transportMissing = state.transportNeeded !== false && state.transportNeeded !== true;
  const hotelMissing = state.hotelNeeded !== false && state.hotelNeeded !== true;

  // Only surface travel add-ons when the journey actually looks travel-related.
  // A local health-program booking should not be turned into an unsolicited
  // transport/hotel sales flow.
  const travelContext =
    state.activeNeed === 'trip' ||
    state.needs.includes('trip') ||
    Boolean(state.origin) ||
    Boolean(state.tripDurationDays) ||
    Boolean(state.checkin || state.checkout);

  // Concierge is progressive, not a sales dump:
  // ask one relevant optional service at a time, then move to the next.
  const askTransport = travelContext && transportMissing;
  const askHotel = travelContext && !transportMissing && hotelMissing;

  if (language === 'en') {
    if (askTransport) return '🚐 Would you like transport from/to your appointment — one-way or daily?';
    if (askHotel) return '🏨 Would you like us to look for a room as well — double or twin, and about what budget per night?';
    return 'Is there anything else you would like Fern to help with?';
  }
  if (language === 'lo') {
    if (askTransport) return '🚐 ຕ້ອງການລົດຮັບສົ່ງໄປ/ກັບຈາກບ່ອນນັດບໍ? ໄປທ່ຽວດຽວ ຫຼື ເໝົາລາຍວັນ?';
    if (askHotel) return '🏨 ຕ້ອງການໃຫ້ໃບເຟີນຊ່ວຍຫາຫ້ອງພັກໃຫ້ນຳບໍ? ຕຽງຄູ່ ຫຼື ຕຽງດ່ຽວ ແລະ ງົບປະມານປະມານເທົ່າໃດຕໍ່ຄືນ?';
    return 'ມີຫຍັງອື່ນໃຫ້ໃບເຟີນຊ່ວຍອີກບໍ?';
  }
  if (askTransport) return '🚐 ต้องการให้ใบเฟิร์นช่วยดูรถรับส่งไป/กลับจากจุดนัดหมายไหมคะ — เที่ยวเดียว หรือเหมารายวัน?';
  if (askHotel) return '🏨 ต้องการให้ใบเฟิร์นช่วยดูห้องพักให้ด้วยไหมคะ — เตียงคู่หรือเตียงเดี่ยว และงบประมาณประมาณเท่าไรต่อคืน?';
  return 'มีอะไรให้ใบเฟิร์นช่วยเพิ่มเติมอีกไหมคะ?';
}

export function isServiceOptionsResponse(text: string): boolean {
  return /(?:รถ|รับส่ง|เที่ยวเดียว|เหมารายวัน|ห้องพัก|เตียงคู่|เตียงเดี่ยว|โรงแรม|transport|one-way|daily|room|hotel|twin|double)/iu.test(text);
}

export function buildHandoffContactPrompt(language: WosLanguage): string {
  if (language === 'lo') {
    return 'ກ່ອນສົ່ງໃຫ້ທີມ WOS ຂໍຊື່ ແລະ ເບີໂທ ຫຼື email ເພື່ອໃຫ້ທີມຕິດຕໍ່ກັບ.';
  }
  if (language === 'en') {
    return 'Before I send this to WOS, please provide your name and a phone number or email so the team can contact you.';
  }
  return 'ก่อนส่งให้ทีม WOS ขอชื่อและเบอร์โทรหรืออีเมลสำหรับให้ทีมติดต่อกลับด้วยนะคะ';
}

export function buildHandoffResultMessage(
  language: WosLanguage,
  notification: 'sent' | 'queued'
): string {
  if (language === 'lo') {
    return notification === 'sent'
      ? 'ຮັບເລື່ອງແລ້ວ 😊 Fern ໄດ້ສົ່ງຄຳຂໍໃຫ້ທີມ WOS ແລ້ວ ແລະທີມຈະຕິດຕໍ່ກັບເພື່ອຢືນຢັນລາຍລະອຽດ.'
      : 'ຮັບເລື່ອງໄວ້ແລ້ວ 😊 ລະບົບກຳລັງສົ່ງໃຫ້ທີມ WOS.';
  }
  if (language === 'en') {
    return notification === 'sent'
      ? 'Got it 😊 Fern has sent your request to the WOS team. They will contact you to confirm the details.'
      : 'Got it 😊 Your request is saved with WOS. The notification is being retried, and the team will contact you once it is delivered.';
  }
  return notification === 'sent'
    ? 'เรียบร้อยค่ะ 😊 ใบเฟิร์นส่งคำขอให้ทีม WOS แล้ว ทีมจะติดต่อกลับเพื่อยืนยันรายละเอียดนะคะ'
    : 'รับเรื่องไว้แล้วค่ะ 😊 ข้อมูลถูกบันทึกกับ WOS แล้ว และระบบกำลังจัดส่งแจ้งเตือนให้ทีมอีกครั้งนะคะ';
}

export function buildHandoffFailureMessage(language: WosLanguage): string {
  if (language === 'lo') {
    return 'ຂໍໂທດຄ່ະ ຕອນນີ້ລະບົບຍັງສົ່ງຄຳຂໍໃຫ້ທີມ WOS ບໍ່ສຳເລັດ. ກະລຸນາລອງອີກຄັ້ງ.';
  }
  if (language === 'en') {
    return 'I’m sorry, the request could not be submitted to the WOS team yet. Please try confirming once more.';
  }
  return 'ขออภัยค่ะ ตอนนี้ระบบยังส่งคำขอให้ทีม WOS ไม่สำเร็จ รบกวนลองยืนยันอีกครั้งนะคะ';
}
