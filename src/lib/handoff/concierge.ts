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
  // At the final concierge step, customers commonly answer the hotel's
  // "สนใจไหม" question with "สนใจ" rather than the formal word "ยืนยัน".
  // The webhook only evaluates this after the journey reaches
  // `awaiting_confirmation`, so this does not trigger an early handoff for
  // transport/hotel questions.
  return /(?:yes|y|ok|okay|confirm|confirmed|correct|ใช่|ถูกต้อง|ยืนยัน|ตกลง|โอเค|ได้เลย|สนใจ|ต้องการ)/iu.test(text);
}

function usableContactName(value: unknown): string {
  const name = String(value ?? '').trim();
  const normalized = name.toLowerCase().replace(/[\s._-]+/g, '');
  const generic = new Set([
    'wosadmin', 'admin', 'administrator', 'visitor', 'guest', 'user', 'customer',
    '\u0e1c\u0e39\u0e49\u0e43\u0e0a\u0e49\u0e07\u0e32\u0e19',
    '\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32', '\u0e41\u0e2d\u0e14\u0e21\u0e34\u0e19',
  ]);
  return name && !generic.has(normalized) ? name : '';
}

export function extractContact(sender: ChatwootSender | undefined, text: string): {
  name: string;
  channel: 'phone' | 'email';
  value: string;
} | null {
  const name = usableContactName(sender?.name);
  const email = String(sender?.email ?? '').trim();
  const phone = String(sender?.phone_number ?? '').trim();
  const textName = text.match(/(?:ชื่อนาย|ชื่อนางสาว|ชื่อนาง|ชื่อ|ผมชื่อ|ฉันชื่อ|ดิฉันชื่อ)\s*([ก-๙A-Za-z]+)/iu)?.[1]?.trim();
  const resolvedName = usableContactName(textName) || name || '';
  if (phone) return { name: resolvedName, channel: 'phone', value: phone };
  if (email) return { name: resolvedName, channel: 'email', value: email };
  const emailInText = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0];
  if (emailInText) return { name: resolvedName, channel: 'email', value: emailInText };
  const phoneInText = text.match(/(?:\+66|0)[\s.-]?(?:\d[\s.-]?){8,10}\d/u)?.[0];
  if (phoneInText) return { name: resolvedName, channel: 'phone', value: phoneInText };
  return null;
}

export function isJourneyReady(state: WosJourneyState): boolean {
  // A selected health/treatment program is itself the active journey need.
  // Do not require a separate needs[] classifier to recognize it.
  // Once the customer has selected a program and provided a name, enter
  // the concierge flow. Date/time can be confirmed by WOS Admin later.
  if (state.selectedProgram) {
    return Boolean(state.customerName);
  }

  if (!state.needs.length) return false;

  if (state.activeNeed === 'trip' || state.needs.includes('trip')) {
    return Boolean(
      state.destination &&
      state.serviceDate &&
      state.travelers &&
      (state.budgetThb || state.budgetUnlimited)
    );
  }

  return Boolean(state.destination && state.serviceDate && state.travelers);
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

export function buildConciergeStagePrompt(language: WosLanguage, state: WosJourneyState): string {
  const coreSummary = [state.selectedProgram ? `• โปรแกรม: ${state.selectedProgram}` : '', state.destination ? `• สถานที่: ${state.destination}` : '', state.serviceDate ? `• วันที่: ${state.serviceDate}` : '', state.serviceTime ? `• เวลา: ${state.serviceTime}` : '', state.customerName ? `• ชื่อผู้จอง: ${state.customerName}` : ''].filter(Boolean).join('\n');
  if (state.transportNeeded === undefined) {
    return language === 'en'
      ? `Here’s the booking summary so far 😊\n\n${coreSummary}\n\nWould you like transport as well?`
      : language === 'lo'
        ? `ໃບເຟີນສະຫຼຸບຂໍ້ມູນກ່ອນນະຄ່ະ 😊\n\n${coreSummary}\n\nຕ້ອງການລົດຮັບສົ່ງເພີ່ມບໍຄ່ະ?`
        : `ใบเฟิร์นขอสรุปข้อมูลที่มีตอนนี้ก่อนนะคะ 😊\n\n${coreSummary}\n\nสนใจรถรับส่งด้วยไหมคะ?`;
  }
  if (state.transportNeeded && !state.transportOrigin) {
    return language === 'en'
      ? 'Got it 😊 What is the pickup point? WOS Admin will coordinate the remaining transport details with you.'
      : language === 'lo'
        ? 'ຮັບຊາບຄ່ະ 😊 ຂໍຈຸດຮັບດ້ວຍນະຄະ ທີມ WOS ຈະປະສານລາຍລະອຽດລົດຮັບສົ່ງຕໍ່ໃຫ້ຄ່ະ'
        : 'รับทราบค่ะ 😊 ขอจุดรับด้วยนะคะ เดี๋ยวทีม WOS จะประสานรายละเอียดรถรับส่งต่อให้ค่ะ';
  }
  // Once pickup is captured, the next transition is hotel interest.
  // Do not let transportNeeded=true mask a hotel decision that is already true.
  if (state.transportNeeded && state.transportOrigin && state.hotelNeeded === undefined) {
    return language === 'en'
      ? 'Perfect 😊 I have noted the transport request. Would you like a hotel as well?'
      : language === 'lo'
        ? 'ຮັບຊາບຄ່ະ 😊 ໃບເຟີນຮັບເລື່ອງລົດຮັບສົ່ງໄວ້ແລ້ວຄ່ະ ສົນໃຈໃຫ້ WOS ຊ່ວຍເລື່ອງໂຮງແຮມເພີ່ມບໍຄ່ະ?'
        : 'เรียบร้อยค่ะ 😊 ใบเฟิร์นรับเรื่องรถรับส่งไว้แล้วนะคะ สนใจให้ WOS ช่วยเรื่องโรงแรมเพิ่มไหมคะ?';
  }
  if (state.hotelNeeded === undefined) {
    return language === 'en'
      ? 'Would you like a hotel as well? If yes, just let me know and I will pass the request to the WOS team.'
      : language === 'lo'
        ? 'ສົນໃຈໂຮງແຮມເພີ່ມບໍຄ່ະ? ຖ້າຕ້ອງການ ໃບເຟີນຈະຮັບເລື່ອງໄວ້ໃຫ້ທີມ WOS ປະສານຕໍ່ຄ່ະ'
        : 'สนใจโรงแรมเพิ่มไหมคะ? ถ้าต้องการ ใบเฟิร์นจะรับเรื่องไว้ให้ทีม WOS ประสานต่อค่ะ';
  }
  // Hotel interest is the final V1 addon step. Accept it immediately and hand off;
  // do not make the customer repeat the request or confirm the same summary.
  if (state.hotelNeeded === true) {
    if (language === 'lo') return 'ຮັບເລື່ອງໂຮງແຮມໄວ້ແລ້ວຄ່ະ 😊 ທີມ WOS ຈະປະສານລາຍລະອຽດຕໍ່ໃຫ້ຄ່ະ';
    if (language === 'en') return 'Got it 😊 I have noted the hotel request. The WOS team will coordinate the hotel details with you.';
    return 'รับเรื่องโรงแรมไว้แล้วนะคะ 😊 เดี๋ยวทีม WOS จะประสานรายละเอียดต่อให้ค่ะ';
  }
  return buildHandoffConfirmation(language);
}

export function buildConciergeReviewPrompt(language: WosLanguage, state: WosJourneyState, contactName?: string): string {
  const summary = [
    state.selectedProgram ? `• โปรแกรม: ${state.selectedProgram}` : '',
    state.selectedProvider ? `• ผู้ให้บริการ: ${state.selectedProvider}` : '',
    state.destination ? `• สถานที่: ${state.destination}` : '',
    state.serviceDate ? `• วันที่: ${state.serviceDate}` : '',
    state.serviceTime ? `• เวลา: ${state.serviceTime}` : '',
    state.transportNeeded && state.transportOrigin ? `• จุดรับรถ: ${state.transportOrigin}` : '',
    state.transportNeeded && state.transportDestination ? `• จุดส่งรถ: ${state.transportDestination}` : '',
    contactName || state.customerName ? `• ชื่อผู้จอง: ${contactName || state.customerName}` : '',
  ].filter(Boolean).join('\n');
  if (language === 'en') return `Summary 😊\n${summary}\n\nWould you like transport or a hotel too?`;
  if (language === 'lo') return `ສະຫຼຸບຂໍ້ມູນ 😊\n${summary}\n\nຕ້ອງການລົດຮັບສົ່ງ ຫຼື ໂຮງແຮມເພີ່ມບໍຄ່ະ?`;
  return `สรุปสั้น ๆ นะคะ 😊\n${summary}\n\nสนใจรถรับส่งหรือโรงแรมเพิ่มไหมคะ?`;
}

export function buildConciergeHandoffSummary(language: WosLanguage, state: WosJourneyState): string {
  const lines = [
    state.selectedProgram ? `• โปรแกรม: ${state.selectedProgram}` : '',
    state.customerName ? `• ชื่อผู้จอง: ${state.customerName}` : '',
    state.transportNeeded === true ? '• รถรับส่ง: ต้องการ' : state.transportNeeded === false ? '• รถรับส่ง: ไม่ต้องการ' : '',
    state.transportNeeded === true && state.transportOrigin ? `• จุดรับ: ${state.transportOrigin}` : '',
    state.hotelNeeded === true ? '• โรงแรม: ต้องการ' : state.hotelNeeded === false ? '• โรงแรม: ไม่ต้องการ' : '',
  ].filter(Boolean);

  if (language === 'lo') {
    const laoLines = lines
      .map((line) => line
        .replace('• โปรแกรม:', '• ໂປຣແກຣມ:')
        .replace('• ชื่อผู้จอง:', '• ຊື່ຜູ້ຈອງ:')
        .replace('• รถรับส่ง: ต้องการ', '• ລົດຮັບສົ່ງ: ຕ້ອງການ')
        .replace('• รถรับส่ง: ไม่ต้องการ', '• ລົດຮັບສົ່ງ: ບໍ່ຕ້ອງການ')
        .replace('• จุดรับ:', '• ຈຸດຮັບ:')
        .replace('• โรงแรม: ต้องการ', '• ໂຮງແຮມ: ຕ້ອງການ')
        .replace('• โรงแรม: ไม่ต้องการ', '• ໂຮງແຮມ: ບໍ່ຕ້ອງການ'));
    return `ສະຫຼຸບຂໍ້ມູນໃຫ້ທີມ WOS ນະຄ່ະ 😊\n\n${laoLines.join('\n')}\n\nໃບເຟີນຈະປະສານທີມ WOS ຕໍ່ໃຫ້ຄ່ະ ແລະທີມງານຈະຕິດຕໍ່ກັບເພື່ອຢືນຢັນລາຍລະອຽດ.`;
  }
  if (language === 'en') {
    const englishLines = lines
      .map((line) => line.replace('• โปรแกรม:', '• Program:').replace('• ชื่อผู้จอง:', '• Name:').replace('• รถรับส่ง: ต้องการ', '• Transport: needed').replace('• รถรับส่ง: ไม่ต้องการ', '• Transport: not needed').replace('• จุดรับ:', '• Pickup:').replace('• โรงแรม: ต้องการ', '• Hotel: needed').replace('• โรงแรม: ไม่ต้องการ', '• Hotel: not needed'));
    return `Here’s a quick summary for the WOS team 😊\n\n${englishLines.join('\n')}\n\nFern will pass this to the WOS team, and they will contact you to confirm the remaining details.`;
  }
  return `สรุปข้อมูลให้ทีม WOS นะคะ 😊\n\n${lines.join('\n')}\n\nใบเฟิร์นจะประสานทีม WOS ต่อให้ค่ะ แล้วทีมงานจะติดต่อกลับเพื่อยืนยันรายละเอียดที่เหลือนะคะ`;
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
    if (askTransport) return '🚗 Would you like transport as well?';
    if (askHotel) return '🏨 Would you like a hotel as well?';
    return 'Is there anything else you would like Fern to help with?';
  }
  if (language === 'lo') {
    if (askTransport) return '🚗 ຕ້ອງການລົດຮັບສົ່ງເພີ່ມບໍຄ່ະ?';
    if (askHotel) return '🏨 ສົນໃຈໂຮງແຮມເພີ່ມບໍຄ່ະ?';
    return 'ມີຫຍັງອື່ນໃຫ້ໃບເຟີນຊ່ວຍອີກບໍ?';
  }
  if (askTransport) return '🚗 สนใจรถรับส่งด้วยไหมคะ?';
  if (askHotel) return '🏨 สนใจโรงแรมด้วยไหมคะ?';
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
