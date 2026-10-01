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
  if (language === 'en') {
    const lines = [transportMissing ? '🚐 Do you need transport — one-way or daily?' : '', hotelMissing ? '🏨 Do you need a room — double or twin bed, and about what budget per night?' : ''].filter(Boolean);
    return lines.length ? lines.join('\\n') : buildHandoffConfirmation(language);
  }
  if (language === 'lo') {
    const lines = [transportMissing ? '🚐 ຕ້ອງການລົດຮັບສົ່ງບໍ? ໄປທ່ຽວດຽວ ຫຼື ເໝົາລາຍວັນ?' : '', hotelMissing ? '🏨 ຕ້ອງການຫ້ອງພັກບໍ? ຕຽງຄູ່ ຫຼື ຕຽງດ່ຽວ ແລະ ງົບປະມານປະມານເທົ່າໃດ?' : ''].filter(Boolean);
    return lines.length ? lines.join('\\n') : buildHandoffConfirmation(language);
  }
  const lines = [transportMissing ? '🚐 ต้องการรถรับส่งไหมคะ — เที่ยวเดียว หรือเหมารายวัน?' : '', hotelMissing ? '🏨 ต้องการห้องพักไหมคะ — เตียงคู่หรือเตียงเดี่ยว และงบประมาณประมาณเท่าไรต่อคืน?' : ''].filter(Boolean);
  return lines.length ? lines.join('\\n') : buildHandoffConfirmation(language);
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
