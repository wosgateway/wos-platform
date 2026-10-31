import { describe, expect, it } from 'vitest';
import { deriveWosJourneyState } from './journey-state';

type M = { role: 'user' | 'assistant'; content: string };

const DETAIL = 'ตรวจเข่า\nราคาโปรโมชั่น 3,500 บาท ระยะเวลา 2 ชั่วโมง\nถ้าสนใจบอกใบเฟิร์นได้เลยค่ะ';
const HOTEL_Q = 'สนใจโรงแรมที่พักใกล้คลินิกไหมคะ?';
const NAME_Q = 'ขอชื่อผู้จองด้วยนะคะ';
const TRANSPORT_Q = 'สนใจรถรับส่งไหมคะ?';

const CONCIERGE_HISTORY: M[] = [
  { role: 'user', content: 'เลือกตรวจเข่า' },
  { role: 'assistant', content: DETAIL },
  { role: 'user', content: 'สนใจ' },
  { role: 'assistant', content: HOTEL_Q },
  { role: 'user', content: 'ไม่ต้องการโรงแรม' },
  { role: 'assistant', content: NAME_Q },
];

describe('selectedProgram persists across the customer-name turn', () => {
  it('T1-T4: selection, hotel decline and name all hold at T4', () => {
    const t1 = deriveWosJourneyState([], 'เลือกตรวจเข่า');
    expect(t1.selectedProgram).toBe('ตรวจเข่า');
    const t2 = deriveWosJourneyState(CONCIERGE_HISTORY.slice(0, 2), 'สนใจ');
    expect(t2.selectedProgram).toBe('ตรวจเข่า');
    const t3 = deriveWosJourneyState(CONCIERGE_HISTORY.slice(0, 4), 'ไม่ต้องการโรงแรม');
    expect(t3.selectedProgram).toBe('ตรวจเข่า');
    expect(t3.hotelNeeded).toBe(false);
    const t4 = deriveWosJourneyState(CONCIERGE_HISTORY, 'สมชาย');
    expect(t4.selectedProgram).toBe('ตรวจเข่า');
    expect(t4.customerName).toBe('สมชาย');
    expect(t4.hotelNeeded).toBe(false);
  });

  it('T5: transport decline keeps program, name and hotel=false', () => {
    const history: M[] = [
      ...CONCIERGE_HISTORY,
      { role: 'user', content: 'สมชาย' },
      { role: 'assistant', content: TRANSPORT_Q },
    ];
    const t5 = deriveWosJourneyState(history, 'ไม่ต้องการรถรับส่ง');
    expect(t5.selectedProgram).toBe('ตรวจเข่า');
    expect(t5.customerName).toBe('สมชาย');
    expect(t5.hotelNeeded).toBe(false);
    expect(t5.transportNeeded).toBe(false);
  });

  it('explicit name "ชื่อสมชาย" is a name answer and keeps the selection', () => {
    const s = deriveWosJourneyState(CONCIERGE_HISTORY, 'ชื่อสมชาย');
    expect(s.selectedProgram).toBe('ตรวจเข่า');
    expect(s.customerName).toBe('สมชาย');
  });
});

describe('pending name alone never revives a stale selection', () => {
  const NOT_NAME_ANSWERS: Array<[string, string]> = [
    ['province', 'เชียงใหม่'],
    ['province (udon)', 'อุดรธานี'],
    ['catalog discovery', 'มีโปรแกรมอะไรบ้าง'],
    ['program lookup', 'นวดแผนไทย'],
    ['reset', 'เริ่มใหม่'],
  ];
  for (const [label, message] of NOT_NAME_ANSWERS) {
    it(`${label}: "${message}" is not a name answer`, () => {
      const s = deriveWosJourneyState(CONCIERGE_HISTORY, message);
      expect(s.selectedProgram).toBeUndefined();
      expect(s.customerName).toBeUndefined();
    });
  }

  it('weather interrupts without clearing selection or becoming a name', () => {
    const s = deriveWosJourneyState(CONCIERGE_HISTORY, 'วันนี้อากาศดี');
    expect(s.selectedProgram).toBe('ตรวจเข่า');
    expect(s.customerName).toBeUndefined();
  });

  it('a service request is an add-on answer, not a name (selection kept by add-on rule only)', () => {
    const s = deriveWosJourneyState(CONCIERGE_HISTORY, 'สนใจรถรับส่ง');
    expect(s.customerName).toBeUndefined();
    expect(s.transportNeeded).toBe(true);
  });
});

describe('existing selection rules still hold', () => {
  it('a new program overrides the old one', () => {
    const s = deriveWosJourneyState(CONCIERGE_HISTORY, 'เลือกตรวจสุขภาพ');
    expect(s.selectedProgram).toBe('ตรวจสุขภาพ');
  });

  it('reset clears selection and later addon answers cannot revive it', () => {
    const history: M[] = [
      ...CONCIERGE_HISTORY,
      { role: 'user', content: 'เริ่มใหม่' },
      { role: 'assistant', content: HOTEL_Q },
    ];
    const s = deriveWosJourneyState(history, 'ไม่ต้องการโรงแรม');
    expect(s.selectedProgram).toBeUndefined();
  });

  it('addon answers preserve the selection', () => {
    const history: M[] = [...CONCIERGE_HISTORY.slice(0, 2), { role: 'user', content: 'สนใจ' }, { role: 'assistant', content: HOTEL_Q }];
    expect(deriveWosJourneyState(history, 'ไม่ต้องการโรงแรม').selectedProgram).toBe('ตรวจเข่า');
  });

  it('no previous selection cannot create one from a name answer', () => {
    const s = deriveWosJourneyState([{ role: 'user', content: 'สวัสดี' }, { role: 'assistant', content: NAME_Q }], 'สมชาย');
    expect(s.selectedProgram).toBeUndefined();
    expect(s.customerName).toBe('สมชาย');
  });
});
