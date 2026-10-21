import { describe, expect, it } from 'vitest';
import { deriveWosJourneyState as derive } from './journey-state';
import { buildHandoffConfirmation } from '../handoff/concierge';
import { buildProgramAnswer, buildFallbackReply, buildProgramPriceAnswer } from './program-answer';

type M = { role: 'user' | 'assistant'; content: string };
const name = 'ขอชื่อสำหรับลงข้อมูลด้วยนะคะ';
const pair = (user: string, assistant: string): M[] => [
  { role: 'user', content: user }, { role: 'assistant', content: assistant },
];
const accepted = pair('เลือกตรวจเข่า', name);

describe('historical named selection acceptance', () => {
  it.each(['th', 'lo', 'en'] as const)('accepts real %s detail without provider, rejects builder fallbacks', language => {
    const message = { th: 'รายละเอียด', lo: 'ຂໍຂໍ້ມູນ', en: 'details' }[language];
    const program = { id: 'fixture', title: 'ตรวจเข่า', special_price: 3500, original_price: 4000, is_promotion: true, duration_minutes: 120 };
    const detail = buildProgramAnswer([program], message, '', language)!;
    expect(derive(pair('เลือกตรวจเข่า', detail), 'วิชัย').selectedProgram).toBe('ตรวจเข่า');
    for (const reply of [buildFallbackReply(message), buildProgramPriceAnswer({ title: 'ตรวจเข่า' }, message, '', language)!]) {
      expect(derive(pair('เลือกตรวจเข่า', reply), 'วิชัย').selectedProgram).toBeUndefined();
    }
  });

  it.each([
    'ตอนนี้ใบเฟิร์นยังไม่พบรายการที่ตรงกับที่ถามในข้อมูลที่ยืนยันแล้วค่ะ ให้ทีม WOS ช่วยตรวจสอบต่อให้ไหมคะ',
    'ຕອນນີ້ໃບເຟີນຍັງບໍ່ພົບລາຍການທີ່ກົງກັບທີ່ຖາມໃນຂໍ້ມູນທີ່ຢືນຢັນແລ້ວຄ່ະ ໃຫ້ທີມ WOS ຊ່ວຍກວດສອບຕໍ່ບໍຄະ',
    'I could not find a matching verified program yet. Would you like the WOS team to check?',
    'ราคา 3,500 บาท', 'ระยะเวลา 2 ชั่วโมง', 'สนใจ',
    'Price: 3500 THB', 'Duration: 120 minutes',
    'ລາຄາ 3500 ບາດ', 'ໄລຍະເວລາ 120 ນາທີ',
  ])('does not treat incomplete fields or rejection as acceptance: %s', reply => {
    expect(derive(pair('เลือกตรวจเข่า', reply), 'วิชัย').selectedProgram).toBeUndefined();
  });

  it('retains an accepted named selection', () => {
    expect(derive(accepted, 'วันที่ 10 ตุลาคม').selectedProgram).toBe('ตรวจเข่า');
  });

  it.each(['th', 'lo', 'en'] as const)('retains replacement through %s handoff confirmation', language => {
    const history = [...accepted, ...pair('สมชาย', 'สนใจรถรับส่งไหมคะ?'),
      ...pair('ไม่ต้องการรถรับส่ง', 'สนใจโรงแรมไหมคะ?'),
      ...pair('ไม่เอาโรงแรม', '• โปรแกรม: ตรวจเข่า'),
      ...pair('เลือกตรวจสุขภาพ', buildHandoffConfirmation(language))];
    expect(derive(history, 'ยืนยัน').selectedProgram).toBe('ตรวจสุขภาพ');
  });

  it.each(['วิชัย', 'สนใจ'])('rejected replacement blocks both old and new selection on %s', message => {
    const history = [...accepted, ...pair('เลือกโปรแกรมที่ไม่มีจริง', 'ยังไม่มีข้อมูลที่ยืนยันค่ะ')];
    expect(derive(history, message).selectedProgram).toBeUndefined();
  });

  it('accepts existing program detail evidence', () => {
    expect(derive(pair('เลือกตรวจเข่า', '1. ตรวจเข่า — Clinic\nราคาโปรโมชั่น 1500 บาท'), 'วิชัย').selectedProgram).toBe('ตรวจเข่า');
  });

  it.each([
    ['เลือกโปรแกรมที่ไม่มีจริง', 'ยังไม่มีข้อมูลที่ยืนยันค่ะ'],
    ['ເລືອກກວດເຂົ່າ', 'ຂໍໂທດ ບໍ່ມີຂໍ້ມູນທີ່ຢືນຢັນ'],
    ['choose nonexistent program', 'I do not have verified information.'],
  ])('does not recover rejected %s', (selection, fallback) => {
    expect(derive(pair(selection, fallback), 'สนใจ').selectedProgram).toBeUndefined();
  });

  it('preserves numeric selection behavior', () => {
    const history: M[] = [{ role: 'assistant', content: '1. ตรวจเข่า — Clinic' }, ...pair('1', 'รับทราบค่ะ')];
    expect(derive(history, 'วันที่ 10 ตุลาคม').selectedProgram).toBe('ตรวจเข่า');
  });

  it('accepts a named selection without an assistant outcome yet', () => {
    expect(derive([{ role: 'user', content: 'เลือกตรวจเข่า' }], 'สนใจ').selectedProgram).toBe('ตรวจเข่า');
  });
});
