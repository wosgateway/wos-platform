import { describe, expect, it } from 'vitest';
import { deriveWosJourneyState as derive, getWosConciergeStage, isTransparentInterruption, deriveActivePendingQuestion } from './journey-state';
import { decideConciergeReply } from './concierge-flow';
type M = { role: 'user' | 'assistant'; content: string };
const NAME = 'ขอชื่อสำหรับลงข้อมูลด้วยนะคะ';
const THANKS = 'ยินดีมากค่ะ 😊';
const base: M[] = [{role:'user',content:'เลือกตรวจเข่า'}, {role:'assistant',content:NAME}, {role:'user',content:'สนใจ'}, {role:'assistant',content:NAME}];
const turn = (history: M[], user: string, assistant = THANKS): M[] => [...history, {role:'user',content:user}, {role:'assistant',content:assistant}];
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

describe('selection boundary controls',()=>{for(const text of ['เริ่มใหม่','เชียงใหม่','มีโปรแกรมอะไรบ้าง','อยากตรวจสุขภาพ'])it(text,()=>{expect(derive(base,text).selectedProgram).toBeUndefined();});it('name context survives supported interruption',()=>{expect(derive(turn(base,'โอเค ขอบคุณ'),'สมชาย')).toMatchObject({selectedProgram:'ตรวจเข่า',customerName:'สมชาย'});});});
