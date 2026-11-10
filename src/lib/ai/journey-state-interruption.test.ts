import { describe, expect, it } from 'vitest';
import { deriveWosJourneyState as derive, getWosConciergeStage, isTransparentInterruption, classifyAssistantQuestion, deriveActivePendingQuestion } from './journey-state';
import { decideConciergeReply } from './concierge-flow';
type M = { role: 'user' | 'assistant'; content: string };
const NAME = 'ขอชื่อสำหรับลงข้อมูลด้วยนะคะ';
const THANKS = 'ยินดีมากค่ะ 😊';
const base: M[] = [{role:'user',content:'เลือกตรวจเข่า'}, {role:'assistant',content:NAME}, {role:'user',content:'สนใจ'}, {role:'assistant',content:NAME}];
const turn = (history: M[], user: string, assistant = THANKS): M[] => [...history, {role:'user',content:user}, {role:'assistant',content:assistant}];
describe('interruption semantic matrix', () => {
  for (const social of ['ขอบคุณ', 'โอเค ขอบคุณ', 'รับทราบครับ', 'ok thanks', 'ຂອບໃຈ', 'ครับ', 'ค่ะ', 'คะ']) {
    it(`recovers selection and name after ${social}`, () => {
      const h = turn(base, social);
      expect(derive(base,social).selectedProgram).toBe('ตรวจเข่า');
      const s = derive(h,'สมชาย');
      expect(s.pendingQuestion).toBeUndefined();
      expect(s.activePendingQuestion).toBe('name');
      expect(s.selectedProgram).toBe('ตรวจเข่า');
      expect(s.customerName).toBe('สมชาย');
      expect(getWosConciergeStage(s)).toBe('ask_transport_interest');
      expect(decideConciergeReply(s,'th')).toContain('รถรับส่ง');
    });
  }
  it('retains hotel decline through interruption, name and transport decline', () => {
    let h = turn(base,'ไม่ต้องการโรงแรม',NAME);
    h = turn(h,'ขอบคุณ');
    h = turn(h,'สมชาย','สนใจรถรับส่งไหมคะ?');
    const s=derive(h,'ไม่ต้องการรถรับส่ง');
    expect(s).toMatchObject({selectedProgram:'ตรวจเข่า',customerName:'สมชาย',hotelNeeded:false,transportNeeded:false});
    expect(getWosConciergeStage(s)).toBe('awaiting_confirmation');
  });
  for (const boundary of ['เริ่มใหม่','อยากตรวจสุขภาพ','เชียงใหม่','มีโปรแกรมอะไรบ้าง','นวดแผนไทย','วันนี้อากาศดี']) {
    it(`does not revive state after ${boundary}`, () => {
      const h=turn(turn(base,'ขอบคุณ'),boundary,'มีอะไรให้ช่วยไหมคะ');
      const s=derive(h,'สมชาย');
      expect(s.selectedProgram).toBe(boundary === 'วันนี้อากาศดี' ? 'ตรวจเข่า' : undefined);
      expect(s.customerName).toBeUndefined();
      expect(s.activePendingQuestion).toBeUndefined();
    });
  }
  for (const addon of ['ขอโรงแรม','ขอรถรับส่ง']) it(`does not read ${addon} as a name`, () => {
    const h=turn(base,'ขอบคุณ');
    const s=derive(h,addon);
    expect(s.customerName).toBeUndefined();
    expect(s.currentTurnAddon).toBeDefined();
    expect(derive(turn(h,addon),'สมชาย').customerName).toBe('สมชาย');
  });
  it('does not invent pending name without a question', () => {
    const s=derive(turn([],'ขอบคุณ'),'สมชาย');
    expect(s.customerName).toBeUndefined(); expect(s.selectedProgram).toBeUndefined();
  });
  it('survives repeated thanks', () => {
    const s=derive(turn(turn(turn(base,'ขอบคุณ'),'ขอบคุณครับ'),'โอเค ขอบคุณ'),'สมชาย');
    expect(s.customerName).toBe('สมชาย'); expect(s.selectedProgram).toBe('ตรวจเข่า');
  });
  it('replaces the old question and binds short addon answer after thanks', () => {
    const h=turn(turn(base,'สมชาย','สนใจโรงแรมไหมคะ?'),'ขอบคุณ');
    const s=derive(h,'เอา');
    expect(s.activePendingQuestion).toBe('hotel'); expect(s.answeredQuestion).toBe('hotel'); expect(s.hotelNeeded).toBe(true);
    expect(s.currentTurnAddon).toBeUndefined();
  });
  it('new selection replaces the old selection', () => {
    const h=turn(turn(base,'ขอบคุณ'),'เลือกตรวจสุขภาพ',NAME);
    expect(derive(h,'สมชาย')).toMatchObject({selectedProgram:'ตรวจสุขภาพ',customerName:'สมชาย'});
  });
  it('never treats mixed requests or negatives as social-only', () => {
    for(const text of ['ขอบคุณ ขอรถรับส่ง','ขอบคุณ อยากได้โรงแรม','ไม่เอา','สมชาย','เชียงใหม่']) expect(isTransparentInterruption(text)).toBe(false);
  });
  it('old numbered catalogs and summaries cannot cross discovery boundaries', () => {
    const h: M[]=[{role:'assistant',content:'1. ตรวจเข่า — 3500 บาท'}, {role:'user',content:'1'}, {role:'assistant',content:NAME}];
    expect(derive(turn(h,'ขอบคุณ'),'สมชาย').selectedProgram).toBe('ตรวจเข่า');
    const ended=turn(turn(h,'มีโปรแกรมอะไรบ้าง','รายการโปรแกรมใหม่'),'ขอบคุณ');
    expect(derive(ended,'สมชาย').selectedProgram).toBeUndefined();
  });
});


describe('ordinary continuation selection retention', () => {
  it('retains selection and extracts a date, including on the following turn', () => {
    const current = derive(base, 'วันที่ 10 ตุลาคม');
    expect(current).toMatchObject({ selectedProgram: 'ตรวจเข่า', serviceDate: 'วันที่ 10 ตุลาคม', bookingIntent: true });
    expect(current.customerName).toBeUndefined();
    expect(current.activePendingQuestion).toBe('name');
    expect(derive(turn(base, 'วันที่ 10 ตุลาคม', NAME), 'สมชาย')).toMatchObject({
      selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย', serviceDate: 'วันที่ 10 ตุลาคม',
    });
  });

  it('retains selection through recognized mixed thanks', () => {
    expect(isTransparentInterruption('ขอบคุณ ຫຼາຍ')).toBe(true);
    expect(derive(base, 'ขอบคุณ ຫຼາຍ').selectedProgram).toBe('ตรวจเข่า');
    expect(derive(turn(base, 'ขอบคุณ ຫຼາຍ', NAME), 'สมชาย').selectedProgram).toBe('ตรวจเข่า');
  });
});

describe('tactical hardening boundaries', () => {
  for (const request of ['ขอโรงแรม พร้อมนวดสปา', 'ขอรถรับส่ง และอยากตรวจสุขภาพ']) {
    it('mixed new service clears old selection/question: ' + request, () => {
      const interrupted = turn(base, 'ขอบคุณ');
      const current = derive(interrupted, request);
      expect(current.selectedProgram).toBeUndefined();
      expect(current.customerName).toBeUndefined();
      expect(current.activePendingQuestion).toBe('name'); // before-turn contract
      expect(current.currentTurnAddon).toBeDefined();
      const after = derive(turn(interrupted, request), 'สมชาย');
      expect(after.selectedProgram).toBeUndefined();
      expect(after.customerName).toBeUndefined();
      expect(after.activePendingQuestion).toBeUndefined();
    });
  }
  it('ambiguous assistant question replaces hidden name context without changing public classifier', () => {
    const ambiguous = 'สนใจรถรับส่งหรือโรงแรมเพิ่มไหมคะ?';
    expect(classifyAssistantQuestion(ambiguous)).toBeUndefined();
    const h = turn(base, 'ขอบคุณ', ambiguous);
    const s = derive(h, 'สมชาย');
    expect(s.pendingQuestion).toBeUndefined();
    expect(s.activePendingQuestion).toBeUndefined();
    expect(s.customerName).toBeUndefined();
  });
  for (const decline of ['ไม่เอา', 'ไม่ต้องการรถรับส่ง']) {
    it('pickup decline closes pickup and a later place cannot re-enable transport: ' + decline, () => {
      const pickup = turn(turn(base, 'สมชาย', 'สนใจรถรับส่งไหมคะ?'), 'สนใจ', 'ขอจุดรับด้วยนะคะ');
      const current = derive(pickup, decline);
      expect(current.activePendingQuestion).toBe('pickup');
      expect(current.answeredQuestion).toBe('transport');
      expect(current.transportNeeded).toBe(false);
      const h = turn(turn(pickup, decline), 'ขอบคุณ');
      expect(deriveActivePendingQuestion(h)).toBeUndefined();
      const after = derive(h, 'เชียงใหม่');
      expect(after.transportNeeded).toBe(false);
      expect(after.transportOrigin).toBeUndefined();
      expect(after.answeredQuestion).toBeUndefined();
    });
  }
  it('real slots close a pickup answered by an origin phrase', () => {
    const pickup = turn(turn(base, 'สมชาย', 'สนใจรถรับส่งไหมคะ?'), 'สนใจ', 'ขอจุดรับด้วยนะคะ');
    const h = turn(pickup, 'จากเวียงจันทน์');
    expect(deriveActivePendingQuestion(h)).toBeUndefined();
    expect(derive(h, 'ขอบคุณ').transportOrigin).toBeDefined();
  });
  it('ambiguous question also clears a previous hotel question', () => {
    const h = turn(turn(base, 'สมชาย', 'สนใจโรงแรมไหมคะ?'), 'ขอบคุณ', 'สนใจรถรับส่งหรือโรงแรมเพิ่มไหมคะ?');
    const s = derive(h, 'เอา');
    expect(s.activePendingQuestion).toBeUndefined();
    expect(s.answeredQuestion).toBeUndefined();
    expect(s.hotelNeeded).toBeUndefined();
  });
});


describe('explicit pickup precedence', () => {
  const transport = turn(base, 'สมชาย', 'สนใจรถรับส่งไหมคะ?');
  const pickup = turn(transport, 'สนใจ', 'ขอจุดรับด้วยนะคะ');
  it('pending transport preserves journey and advances to hotel for explicit pickup', () => {
    const s = derive(transport, 'สนใจ รับที่สนามบินอุดรธานี 2 คน');
    expect(s).toMatchObject({selectedProgram:'ตรวจเข่า',customerName:'สมชาย',transportNeeded:true,transportOrigin:'สนามบินอุดรธานี'});
    expect(getWosConciergeStage(s)).toBe('ask_hotel_interest');
    expect(decideConciergeReply(s, 'th')).toContain('สนใจโรงแรม');
  });
  it('pending pickup accepts an explicit place containing a province', () => {
    const s = derive(pickup, 'รับที่สนามบินอุดรธานี');
    expect(s).toMatchObject({selectedProgram:'ตรวจเข่า',customerName:'สมชาย',transportNeeded:true,transportOrigin:'สนามบินอุดรธานี'});
    expect(getWosConciergeStage(s)).toBe('ask_hotel_interest');
  });
  for (const [label, history] of [['transport', transport], ['pickup', pickup]] as const) {
    for (const message of ['อุดรธานีมีโปรแกรมอะไรบ้าง รับที่สนามบินอุดรธานี', 'อยากตรวจสุขภาพ รับที่สนามบินอุดรธานี']) {
      it(label + ': pickup cannot override discovery/new-service: ' + message, () => {
        const s = derive(history, message);
        expect(s.selectedProgram).toBeUndefined();
        expect(deriveActivePendingQuestion(turn(history, message))).toBeUndefined();
      });
    }
    it(label + ': reset prevents pickup from reviving the old journey', () => {
      const reset = derive(history, 'เริ่มใหม่');
      expect(reset.selectedProgram).toBeUndefined();
      expect(reset.transportOrigin).toBeUndefined();
      const s = derive(turn(history, 'เริ่มใหม่'), 'รับที่สนามบินอุดรธานี');
      expect(s.selectedProgram).toBeUndefined();
      expect(s.activePendingQuestion).toBeUndefined();
    });
  }
  it('a province alone while pending transport is not a pickup', () => {
    const s = derive(transport, 'อุดรธานี');
    expect(s.selectedProgram).toBeUndefined();
    expect(s.transportOrigin).toBeUndefined();
    expect(s.transportNeeded).toBeUndefined();
    expect(s.answeredQuestion).toBeUndefined();
  });
});
