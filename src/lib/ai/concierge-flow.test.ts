import { describe, expect, it } from 'vitest';
import {
  classifyAssistantQuestion,
  deriveWosJourneyState,
  isShortAffirmative,
  isShortNegative,
  isThanksMessage,
  type WosJourneyState,
} from './journey-state';
import { decideConciergeReply } from './concierge-flow';
import type { WosAIHistoryMessage } from './core';
import type { WosLanguage } from './language-dictionary';
import { isHandoffConfirmation } from '@/lib/handoff/concierge';

/**
 * Whole-conversation regression for the selected-program concierge intake:
 *   program -> name -> transport? -> pickup -> hotel? -> summary for WOS.
 *
 * Every turn goes through the real journey-state derivation and the real
 * concierge controller, exactly the way core.ts calls them, so these tests fail
 * if a short answer ever binds to the wrong question again.
 */

const RESET = /^(?:เริ่มข้อมูลใหม่|เริ่มใหม่|เริ่มคุยใหม่|จองใหม่(?:เลย)?|ล้างข้อมูล(?:เดิม)?|start over|reset)$/iu;

class Chat {
  history: WosAIHistoryMessage[];
  last!: { reply: string | null; state: WosJourneyState };

  constructor(seed: WosAIHistoryMessage[], private lang: WosLanguage = 'th') {
    this.history = [...seed];
  }

  say(text: string) {
    const state = deriveWosJourneyState(this.history, text);
    let reply: string | null;
    if (RESET.test(text.trim())) reply = 'เรียบร้อยค่ะ 😊 ใบเฟิร์นล้างข้อมูลการจองเดิมให้แล้วนะคะ เริ่มข้อมูลใหม่ได้เลยค่ะ';
    else if (isThanksMessage(text)) reply = 'ยินดีมากค่ะ 😊';
    else reply = decideConciergeReply(state, this.lang);
    this.history.push({ role: 'user', content: text });
    if (reply) this.history.push({ role: 'assistant', content: reply });
    this.last = { reply, state };
    return this.last;
  }
}

const CATALOG_TH =
  '1. ตรวจเข่า — 1,500 บาท ระยะเวลา 30 นาที\n2. ตรวจสุขภาพ — 1,900 บาท ระยะเวลา 60 นาที';

const seedTh = (program = 'ตรวจเข่า'): WosAIHistoryMessage[] => [
  { role: 'user', content: 'มีโปรแกรมอะไรบ้าง' },
  { role: 'assistant', content: CATALOG_TH },
  { role: 'user', content: program },
  { role: 'assistant', content: 'ได้เลยค่ะ 😊 ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ' },
];

/** Customer has chosen the program and given a name; Fern is now asking about transport. */
function chatAtTransportQuestion(program = 'ตรวจเข่า') {
  const chat = new Chat(seedTh(program));
  const { reply, state } = chat.say('สมชาย');
  expect(state.customerName).toBe('สมชาย');
  expect(reply).toContain('รถรับส่ง');
  return chat;
}

const slots = (s: WosJourneyState) => ({
  program: s.selectedProgram,
  name: s.customerName,
  transport: s.transportNeeded,
  pickup: s.transportOrigin,
  hotel: s.hotelNeeded,
});

describe('concierge journey: yes/no answers bind to the question just asked', () => {
  it('transport "สนใจ" sets transport only; hotel stays unanswered and Fern asks for the pickup', () => {
    const chat = chatAtTransportQuestion();
    const { reply, state } = chat.say('สนใจ');
    expect(state.transportNeeded).toBe(true);
    expect(state.hotelNeeded).toBeUndefined();
    expect(state.answeredQuestion).toBe('transport');
    expect(reply).toContain('จุดรับ');
    expect(reply).not.toContain('โรงแรม');
    expect(state.selectedProgram).toBe('ตรวจเข่า');
  });

  it('pickup is captured (any place), then the hotel question comes next', () => {
    const chat = chatAtTransportQuestion();
    chat.say('สนใจ');
    const { reply, state } = chat.say('ตลาดเช้า');
    expect(state.transportOrigin).toBe('ตลาดเช้า');
    expect(state.answeredQuestion).toBe('pickup');
    expect(state.hotelNeeded).toBeUndefined();
    expect(reply).toContain('สนใจโรงแรม');
  });

  it('hotel "สนใจ" completes the intake with a full summary', () => {
    const chat = chatAtTransportQuestion();
    chat.say('สนใจ');
    chat.say('เวียงจันทน์');
    const { reply, state } = chat.say('สนใจ');
    expect(state.hotelNeeded).toBe(true);
    expect(slots(state)).toEqual({ program: 'ตรวจเข่า', name: 'สมชาย', transport: true, pickup: 'เวียงจันทน์', hotel: true });
    expect(reply).toContain('รถรับส่ง: ต้องการ');
    expect(reply).toContain('จุดรับ: เวียงจันทน์');
    expect(reply).toContain('โรงแรม: ต้องการ');
  });

  it('hotel "ไม่เอา" records hotel = not needed and still closes with a summary', () => {
    const chat = chatAtTransportQuestion();
    chat.say('สนใจ');
    chat.say('เวียงจันทน์');
    const { reply, state } = chat.say('ไม่เอาครับ');
    expect(state.hotelNeeded).toBe(false);
    expect(state.transportNeeded).toBe(true);
    expect(state.transportOrigin).toBe('เวียงจันทน์');
    expect(reply).toContain('โรงแรม: ไม่ต้องการ');
    expect(reply).toContain('รถรับส่ง: ต้องการ');
  });

  it('declining transport clears the pickup, skips it, and asks the hotel question without mentioning a pickup', () => {
    const chat = chatAtTransportQuestion();
    const { reply, state } = chat.say('ไม่เอาครับ');
    expect(state.transportNeeded).toBe(false);
    expect(state.transportOrigin).toBeUndefined();
    expect(state.hotelNeeded).toBeUndefined();
    expect(reply).toContain('สนใจโรงแรม');
    expect(reply).not.toContain('จุดรับ');
    const end = chat.say('สนใจ');
    expect(end.state.hotelNeeded).toBe(true);
    expect(end.state.transportNeeded).toBe(false);
    expect(end.reply).toContain('รถรับส่ง: ไม่ต้องการ');
    expect(end.reply).toContain('โรงแรม: ต้องการ');
  });

  it('declining both ends with both marked not needed', () => {
    const chat = chatAtTransportQuestion();
    chat.say('ไม่');
    const { reply, state } = chat.say('ไม่ต้องการ');
    expect(state.transportNeeded).toBe(false);
    expect(state.hotelNeeded).toBe(false);
    expect(reply).toContain('รถรับส่ง: ไม่ต้องการ');
    expect(reply).toContain('โรงแรม: ไม่ต้องการ');
  });

  it('a hotel decline never erases an accepted transport request', () => {
    const chat = chatAtTransportQuestion();
    chat.say('สนใจ');
    chat.say('เวียงจันทน์');
    chat.say('ไม่ต้องการ');
    expect(chat.last.state.transportNeeded).toBe(true);
    expect(chat.last.state.transportOrigin).toBe('เวียงจันทน์');
  });
});

describe('concierge journey: unrelated turns do not move state', () => {
  it.each(['ขอบคุณ', 'ขอบคุณ ຫຼາຍ', 'ຂອບໃຈ มาก', 'ຂອບໃຈຫຼາຍ'])('acknowledges %s after summary without replaying confirmation', text => {
    const chat = chatAtTransportQuestion();
    chat.say('ไม่ต้องการรถรับส่ง');
    chat.say('ไม่เอาโรงแรม');
    const before = slots(chat.last.state);
    const { reply, state } = chat.say(text);
    expect(reply).toMatch(/ยินดี|ຍິນດີ|ขอบคุณ|ຂອບໃຈ/u);
    expect(reply).not.toMatch(/ยืนยัน|รถรับส่ง|โรงแรม|ขอชื่อ/u);
    expect(classifyAssistantQuestion(reply!)).toBeUndefined();
    expect(state).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย', transportNeeded: false, hotelNeeded: false });
    expect(slots(state)).toEqual(before);
  });

  it('"ขอบคุณ" at every stage leaves every slot unchanged', () => {
    const chat = chatAtTransportQuestion();
    const stages: Array<() => void> = [
      () => undefined, // transport question open
      () => chat.say('สนใจ'), // pickup question open
      () => chat.say('ตลาดเช้า'), // hotel question open
      () => chat.say('สนใจ'), // summary shown
    ];
    for (const advance of stages) {
      advance();
      const before = slots(deriveWosJourneyState(chat.history, 'ครับ'));
      const { reply, state } = chat.say('ขอบคุณครับ');
      expect(reply).toBe('ยินดีมากค่ะ 😊');
      expect(state.answeredQuestion).toBeUndefined();
      expect(slots(state)).toEqual(before);
    }
  });

  it('a bare polite filler is not taken as the pickup point', () => {
    const chat = chatAtTransportQuestion();
    chat.say('สนใจ');
    for (const filler of ['ครับ', 'ค่ะ', 'อืม', 'สนใจ', 'ขอบคุณครับ']) {
      expect(chat.say(filler).state.transportOrigin).toBeUndefined();
    }
  });

  it('a question asked at the pickup stage is not stored as the pickup point', () => {
    const chat = chatAtTransportQuestion();
    chat.say('สนใจ');
    expect(chat.say('ค่ารถเท่าไหร่คะ').state.transportOrigin).toBeUndefined();
  });

  it('"เริ่มใหม่" clears the journey, and a later bare "สนใจ" cannot revive old answers', () => {
    const chat = chatAtTransportQuestion();
    chat.say('สนใจ');
    chat.say('ตลาดเช้า');
    chat.say('สนใจ');
    const reset = chat.say('เริ่มใหม่');
    expect(reset.state.selectedProgram).toBeUndefined();
    expect(reset.state.transportNeeded).toBeUndefined();
    expect(reset.state.hotelNeeded).toBeUndefined();
    expect(reset.state.transportOrigin).toBeUndefined();
    const after = chat.say('สนใจ');
    expect(after.state.transportNeeded).toBeUndefined();
    expect(after.state.hotelNeeded).toBeUndefined();
    expect(after.state.transportOrigin).toBeUndefined();
  });
});

describe('concierge journey: the original bug shapes', () => {
  it('a message that offers transport AND hotel in one question cannot be settled by one "สนใจ"', () => {
    const chat = new Chat([
      ...seedTh(),
      { role: 'user', content: 'สมชาย' },
      { role: 'assistant', content: 'สรุปสั้น ๆ นะคะ 😊\n• โปรแกรม: ตรวจเข่า\n\nสนใจรถรับส่งหรือโรงแรมเพิ่มไหมคะ?' },
    ]);
    const { reply, state } = chat.say('สนใจ');
    expect(state.transportNeeded).toBeUndefined();
    expect(state.hotelNeeded).toBeUndefined();
    // Fern then asks ONE question at a time.
    expect(reply).toContain('รถรับส่ง');
    expect(reply).not.toContain('โรงแรม');
  });

  it('an earlier hotel mention in the same message does not make a transport "สนใจ" a hotel answer', () => {
    const chat = new Chat([
      ...seedTh(),
      { role: 'user', content: 'สมชาย' },
      { role: 'assistant', content: 'ตรวจเข่าที่อุดรธานี ถ้าต้องการที่พักก็มีโรงแรมใกล้คลินิกค่ะ สนใจรถรับส่งด้วยไหมคะ?' },
    ]);
    const { state } = chat.say('สนใจ');
    expect(state.transportNeeded).toBe(true);
    expect(state.hotelNeeded).toBeUndefined();
  });

  it('answering a transport/hotel question never re-selects a program from an older catalog', () => {
    // The customer chose the SECOND program. A later bare "สนใจ" must not jump back to the first.
    const chat = chatAtTransportQuestion('ตรวจสุขภาพ');
    expect(chat.last.state.selectedProgram).toBe('ตรวจสุขภาพ');
    expect(chat.say('สนใจ').state.selectedProgram).toBe('ตรวจสุขภาพ');
    chat.say('เวียงจันทน์');
    expect(chat.say('ไม่เอา').state.selectedProgram).toBe('ตรวจสุขภาพ');
  });

  it('an explicit early "ต้องการโรงแรมด้วย" is honoured (no re-ask); a later explicit decline overrides it', () => {
    const chat = new Chat([
      { role: 'user', content: 'ต้องการโรงแรมด้วย' },
      ...seedTh(),
    ]);
    chat.say('สมชาย');
    const afterTransportNo = chat.say('ไม่เอา'); // answers the transport question only
    expect(afterTransportNo.state.transportNeeded).toBe(false);
    expect(afterTransportNo.state.hotelNeeded).toBe(true);
    expect(afterTransportNo.reply).toContain('โรงแรม: ต้องการ');
    expect(chat.say('เปลี่ยนใจ ไม่เอาโรงแรมแล้วนะ').state.hotelNeeded).toBe(false);
  });

  it('explicit statements that name a service are honoured at any time, and only for that service', () => {
    const s1 = deriveWosJourneyState([], 'สนใจรถรับส่งครับ');
    expect(s1.transportNeeded).toBe(true);
    expect(s1.hotelNeeded).toBeUndefined();
    const s2 = deriveWosJourneyState([], 'ไม่เอารถ แต่ขอโรงแรมด้วย');
    expect(s2.transportNeeded).toBe(false);
    expect(s2.hotelNeeded).toBe(true);
    const s3 = deriveWosJourneyState([], 'ต้องการรถรับส่งและโรงแรม');
    expect(s3.transportNeeded).toBe(true);
    expect(s3.hotelNeeded).toBe(true);
    const s4 = deriveWosJourneyState([], 'ไม่ต้องการรถและโรงแรม');
    expect(s4.transportNeeded).toBe(false);
    expect(s4.hotelNeeded).toBe(false);
  });

  it('a stray place name earlier in the chat is not a pickup point before transport is requested', () => {
    const s = deriveWosJourneyState([{ role: 'user', content: 'ผมมาจากเวียงจัน ปวดเข่า' }, { role: 'assistant', content: 'ยินดีค่ะ' }], 'สนใจรถรับส่ง');
    expect(s.transportNeeded).toBe(true);
    expect(s.transportOrigin).toBeUndefined();
  });

  it('pickup can ride along with the transport request, or an explicit "รับที่" phrase', () => {
    const chat = chatAtTransportQuestion();
    const { state } = chat.say('สนใจ รับที่สนามบินอุดรธานี 2 คน');
    expect(state.transportNeeded).toBe(true);
    expect(state.transportOrigin).toBe('สนามบินอุดรธานี');
    expect(state.hotelNeeded).toBeUndefined();
    expect(decideConciergeReply(state, 'th')).toContain('สนใจโรงแรม');
  });
});

describe('concierge journey: Lao and English', () => {
  const seedEn: WosAIHistoryMessage[] = [
    { role: 'user', content: 'what programs do you have' },
    { role: 'assistant', content: '1. Knee check — 1,500 THB duration 30 min\n2. Health check — 1,900 THB duration 60 min' },
    { role: 'user', content: 'Knee check' },
    { role: 'assistant', content: 'Perfect 😊 What name should I use for the booking?' },
  ];

  it('English: yes -> pickup -> no hotel', () => {
    const chat = new Chat(seedEn, 'en');
    expect(chat.say('John').reply).toBe('Got it 😊 Would you like transport as well?');
    const yes = chat.say('Yes');
    expect(yes.state.transportNeeded).toBe(true);
    expect(yes.state.hotelNeeded).toBeUndefined();
    expect(yes.reply).toContain('pickup point');
    const pickup = chat.say('Vientiane');
    expect(pickup.state.transportOrigin).toBe('Vientiane');
    expect(pickup.reply).toContain('Would you like a hotel');
    const no = chat.say('No thanks');
    expect(no.state.hotelNeeded).toBe(false);
    expect(no.reply).toContain('Hotel: not needed');
    expect(no.reply).toContain('Transport: needed');
  });

  it('Lao: ສົນໃຈ binds to transport only, ບໍ່ເອົາ to hotel only', () => {
    const chat = new Chat(seedTh(), 'lo');
    chat.say('ສົມຊາຍ');
    const yes = chat.say('ສົນໃຈ');
    expect(yes.state.transportNeeded).toBe(true);
    expect(yes.state.hotelNeeded).toBeUndefined();
    chat.say('ວຽງຈັນ');
    const no = chat.say('ບໍ່ເອົາ');
    expect(no.state.hotelNeeded).toBe(false);
    expect(no.state.transportNeeded).toBe(true);
  });
});

describe('concierge journey: durable state', () => {
  it('recovers add-on answers from Fern\'s own summary once the original turns left the history window', () => {
    const history: WosAIHistoryMessage[] = [
      {
        role: 'assistant',
        content:
          'สรุปข้อมูลให้ทีม WOS นะคะ 😊\n\n• โปรแกรม: ตรวจเข่า\n• ชื่อผู้จอง: สมชาย\n• รถรับส่ง: ต้องการ\n• จุดรับ: เวียงจันทน์\n• โรงแรม: ไม่ต้องการ\n\nใบเฟิร์นจะประสานทีม WOS ต่อให้ค่ะ',
      },
    ];
    const s = deriveWosJourneyState(history, 'ขอบคุณครับ');
    expect(slots(s)).toEqual({ program: 'ตรวจเข่า', name: 'สมชาย', transport: true, pickup: 'เวียงจันทน์', hotel: false });
  });

  it('a later correction overrides the earlier summary', () => {
    const history: WosAIHistoryMessage[] = [
      { role: 'assistant', content: 'สรุปข้อมูลให้ทีม WOS นะคะ 😊\n\n• โปรแกรม: ตรวจเข่า\n• ชื่อผู้จอง: สมชาย\n• รถรับส่ง: ต้องการ\n• จุดรับ: เวียงจันทน์\n• โรงแรม: ไม่ต้องการ' },
    ];
    expect(deriveWosJourneyState(history, 'ขอโรงแรมด้วยนะครับ').hotelNeeded).toBe(true);
  });
});

describe('question classifier and reply parsing', () => {
  it('identifies the single open question in every Fern template (th / en / lo)', () => {
    const cases: Array<[string, ReturnType<typeof classifyAssistantQuestion>]> = [
      ['รับทราบค่ะ 😊 สนใจรถรับส่งด้วยไหมคะ?', 'transport'],
      ['Got it 😊 Would you like transport as well?', 'transport'],
      ['ຮັບຊາບຄ່ະ 😊 ສົນໃຈລົດຮັບສົ່ງນຳບໍຄ່ະ?', 'transport'],
      ['ได้เลยค่ะ 😊 ขอจุดรับด้วยนะคะ เดี๋ยวทีม WOS จะประสานรายละเอียดรถส่วนที่เหลือต่อให้ค่ะ', 'pickup'],
      ['Sure 😊 What is the pickup point? The WOS team will coordinate the remaining transport details with you.', 'pickup'],
      ['ໄດ້ຄ່ະ 😊 ຂໍຈຸດຮັບດ້ວຍນະຄະ ທີມ WOS ຈະປະສານລາຍລະອຽດລົດສ່ວນທີ່ເຫຼືອຕໍ່ໃຫ້ຄ່ະ', 'pickup'],
      ['เรียบร้อยค่ะ 😊 ใบเฟิร์นมีจุดรับแล้วนะคะ สนใจโรงแรมด้วยไหมคะ?', 'hotel'],
      ['Perfect 😊 I have the pickup point. Would you like a hotel too?', 'hotel'],
      ['ຮັບຊາບແລ້ວ 😊 ໃບເຟີນມີຈຸດຮັບແລ້ວ. ສົນໃຈໂຮງແຮມນຳບໍຄ່ະ?', 'hotel'],
      ['รับทราบค่ะ 😊 สนใจโรงแรมด้วยไหมคะ?', 'hotel'],
      ['เรียบร้อยค่ะ 😊 ใบเฟิร์นรับเรื่องรถรับส่งไว้แล้วนะคะ สนใจให้ WOS ช่วยเรื่องโรงแรมเพิ่มไหมคะ?', 'hotel'],
      ['ได้เลยค่ะ 😊 ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ', 'name'],
      ['สรุปสั้น ๆ นะคะ 😊\nสนใจรถรับส่งหรือโรงแรมเพิ่มไหมคะ?', undefined],
      ['Summary 😊\nWould you like transport or a hotel too?', undefined],
      ['สรุปข้อมูลให้ทีม WOS นะคะ 😊\n• รถรับส่ง: ต้องการ\n• โรงแรม: ไม่ต้องการ', undefined],
      ['ยินดีมากค่ะ 😊', undefined],
    ];
    for (const [text, expected] of cases) expect(classifyAssistantQuestion(text), text).toBe(expected);
  });

  it('short affirmative / negative / thanks parsing is exact, not substring-based', () => {
    for (const t of ['สนใจ', 'สนใจครับ', 'สนใจค่ะ 😊', 'ต้องการ', 'ใช่', 'ได้เลยครับ', 'yes', 'Yes!', 'ok', 'ສົນໃຈ', 'ເອົາ']) expect(isShortAffirmative(t), t).toBe(true);
    for (const t of ['ไม่', 'ไม่เอา', 'ไม่เอาครับ', 'ไม่ต้องการค่ะ', 'ไม่สนใจ', 'no', 'No thanks', 'ไม่ ขอบคุณครับ', 'ບໍ່', 'ບໍ່ເອົາ']) expect(isShortNegative(t), t).toBe(true);
    for (const t of ['สนใจโรงแรม', 'สนใจตรวจเข่า', 'ไม่เอารถ แต่ขอโรงแรม', 'ราคาเท่าไร']) {
      expect(isShortAffirmative(t), t).toBe(false);
      expect(isShortNegative(t), t).toBe(false);
    }
    expect(isThanksMessage('ขอบคุณครับ')).toBe(true);
    expect(isThanksMessage('ขอบคุณ ผมสนใจโรงแรม')).toBe(false);
  });

  it('a refusal is never read as a handoff confirmation', () => {
    for (const t of ['ไม่สนใจ', 'ไม่ต้องการ', 'ไม่เอาครับ', 'no', 'ยังไม่ครับ', 'ບໍ່ສົນໃຈ']) expect(isHandoffConfirmation(t), t).toBe(false);
    for (const t of ['สนใจ', 'ต้องการค่ะ', 'ยืนยัน', 'yes, confirm', 'ใช่ครับ ยืนยันได้เลย', 'ok']) expect(isHandoffConfirmation(t), t).toBe(true);
    expect(isHandoffConfirmation('Gym booking please')).toBe(false); // 'y' inside a word is not "y"
  });
});
