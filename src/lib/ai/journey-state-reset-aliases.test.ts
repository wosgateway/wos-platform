import { describe, expect, it } from 'vitest';
import { deriveWosJourneyState } from './journey-state';
import type { WosAIHistoryMessage } from './core';

const history: WosAIHistoryMessage[] = [
  { role: 'user', content: 'เลือกตรวจเข่า' },
  { role: 'assistant', content: 'ได้เลยค่ะ ขอชื่อสำหรับลงข้อมูลด้วยนะคะ' },
  { role: 'user', content: 'สมชาย' },
  { role: 'assistant', content: 'สนใจรถรับส่งด้วยไหมคะ?' },
  { role: 'user', content: 'รับที่สนามบินอุดรธานี' },
  { role: 'assistant', content: 'สนใจโรงแรมไหมคะ?' },
  { role: 'user', content: 'วันที่ 10 ตุลาคม' },
];

describe('established multilingual reset aliases isolate journey history', () => {
  it.each([
    'เริ่มใหม่', 'start new', 'new booking', 'new journey',
    'clear previous', 'clear data', 'ເລີ່ມໃໝ່', 'ຈອງໃໝ່',
  ])('%s clears the journey and a later interest cannot revive old slots', reset => {
    expect(deriveWosJourneyState(history, '')).toMatchObject({
      selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย', serviceDate: 'วันที่ 10 ตุลาคม',
      transportOrigin: 'สนามบินอุดรธานี',
    });
    const resetState = deriveWosJourneyState(history, reset);
    expect(resetState.bookingIntent).toBe(false);
    const nextHistory: WosAIHistoryMessage[] = [
      ...history, { role: 'user', content: reset },
      { role: 'assistant', content: 'เริ่มใหม่แล้วค่ะ' },
    ];
    for (const state of [resetState, deriveWosJourneyState(nextHistory, 'สนใจ')]) {
      for (const key of [
        'selectedProgram', 'selectedProvider', 'customerName', 'serviceDate',
        'transportOrigin', 'transportNeeded', 'hotelNeeded',
        'pendingQuestion', 'activePendingQuestion', 'answeredQuestion',
      ] as const) expect(state[key], key).toBeUndefined();
    }
  });
});
