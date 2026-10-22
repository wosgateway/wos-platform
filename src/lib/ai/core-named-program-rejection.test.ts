import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWosAI, type WosAIHistoryMessage } from './core';
import { classifyAssistantQuestion, deriveWosJourneyState, extractRejectedProgramTitle, getWosConciergeStage } from './journey-state';
import { isHandoffConfirmation, isJourneyReady } from '../handoff/concierge';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), search: vi.fn(), knowledge: vi.fn(), forbidden: vi.fn() }));
vi.mock('./understanding/gate', () => ({ runUnderstandingGate: mocks.gate }));
vi.mock('./notion-knowledge', () => ({ searchWosNotionKnowledge: mocks.knowledge }));
vi.mock('./programs', async importOriginal => ({
  ...await importOriginal<typeof import('./programs')>(),
  searchPrograms: mocks.search, searchHealthProgramOverview: mocks.forbidden,
  getCatalogProvinces: mocks.forbidden, getProgramDetails: mocks.forbidden,
}));
vi.mock('./hotel-availability', () => ({ searchHotelAvailability: mocks.forbidden }));
vi.mock('@/lib/supabase/server', () => ({ createAnonClient: mocks.forbidden }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.forbidden }));
vi.mock('openai', () => ({ default: class { constructor() { mocks.forbidden(); } } }));

const catalog = ['ตรวจเข่า', 'ตรวจสุขภาพ', 'ฟื้นฟูข้อเท้า'].map((title, i) => ({
  id: String(i), title, special_price: 1500 + i * 100, partner: { name: 'Fixture', province: 'อุดรธานี' },
}));
// Historical R41 journey: complete intake, but no real handoff is performed.
const history: WosAIHistoryMessage[] = [
  { role: 'user', content: 'เลือกตรวจเข่า' },
  { role: 'assistant', content: 'ได้เลยค่ะ 😊 ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ' },
  { role: 'user', content: 'ສົມຊາຍ' },
  { role: 'assistant', content: 'รับทราบค่ะ 😊 สนใจรถรับส่งด้วยไหมคะ?' },
  { role: 'user', content: 'ບໍ່ຕ້ອງການລົດຮັບສົ່ງ' },
  { role: 'assistant', content: 'ຮັບຊາບຄ່ະ 😊 ສົນໃຈໂຮງແຮມນຳບໍຄ່ະ?' },
  { role: 'user', content: 'ไม่เอาโรงแรม' },
  { role: 'assistant', content: 'สรุปข้อมูลให้ทีม WOS นะคะ 😊\n• โปรแกรม: ตรวจเข่า\n• ชื่อผู้จอง: ສົມຊາຍ\n• รถรับส่ง: ไม่ต้องการ\n• โรงแรม: ไม่ต้องการ' },
];
const append = (h: WosAIHistoryMessage[], input: string, answer: string): WosAIHistoryMessage[] =>
  [...h, { role: 'user', content: input }, { role: 'assistant', content: answer }];
const slots = (h: WosAIHistoryMessage[], input = '') => {
  const s = deriveWosJourneyState(h, input);
  return { name: s.customerName, transport: s.transportNeeded, pickup: s.transportOrigin, hotel: s.hotelNeeded };
};
function noExternalWork() {
  for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
}
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.gate.mockResolvedValue({ handled: false });
  mocks.knowledge.mockResolvedValue([]);
  mocks.search.mockImplementation(async (query: string) => catalog.filter(item => query.includes(item.title)));
  mocks.forbidden.mockImplementation(() => { throw new Error('Unexpected external operation'); });
});

describe('named program rejection through real core and journey replay', () => {
  it.each([
    ['ไม่เอาครับ', 'transport'],
    ['ไม่เอาครับ', 'hotel'],
    ['ไม่ค่ะ', 'transport'],
    ['ไม่ ขอบคุณครับ', 'transport'],
    ['ไม่เอารถ', 'transport'],
    ['ไม่เอาโรงแรม', 'hotel'],
    ['ไม่เอารถ แต่ขอโรงแรมด้วย', 'transport'],
  ] as const)('keeps %s under pending %s out of named-program cancellation', async (input, pending) => {
    const h = history.slice(0, pending === 'hotel' ? 6 : 4);
    expect(deriveWosJourneyState(h, '').activePendingQuestion).toBe(pending);
    expect(extractRejectedProgramTitle(input, h)).toBeUndefined();
    const answer = await runWosAI(input, h);
    const state = deriveWosJourneyState(h, input);
    expect(state.selectedProgram).toBe('ตรวจเข่า');
    expect(state.rejectedProgram).toBeUndefined();
    if (pending === 'hotel') expect(state.hotelNeeded).toBe(false);
    else expect(state.transportNeeded).toBe(false);
    if (input === 'ไม่เอารถ แต่ขอโรงแรมด้วย') expect(state.hotelNeeded).toBe(true);
    else if (pending === 'transport') expect(classifyAssistantQuestion(answer)).toBe('hotel');
  });

  it('requires independent identity evidence instead of treating arbitrary residual text as a program', () => {
    expect(extractRejectedProgramTitle('ไม่เอาเรื่องที่แต่งขึ้น', history)).toBeUndefined();
    expect(extractRejectedProgramTitle('ไม่เอาฟื้นฟูข้อเท้า', [])).toBeUndefined();
    const h = history.map(m => ({ ...m, content: m.content.replaceAll('ตรวจเข่า', 'ฟื้นฟูข้อเท้า') }));
    expect(extractRejectedProgramTitle('ไม่เอาฟื้นฟูข้อเท้า', h)).toBe('ฟื้นฟูข้อเท้า');
    expect(extractRejectedProgramTitle('ไม่เอาตรวจเข่า', [])).toBe('ตรวจเข่า');
    expect(extractRejectedProgramTitle('ไม่เอาກວດເຂົ່າ', [])).toBe('ตรวจเข่า');
  });

  it('reproduces Phase 10: rejects the selected program without searching or changing unrelated slots', async () => {
    const input = 'ไม่เอาตรวจเข่า';
    const original = structuredClone(history);
    expect(deriveWosJourneyState(history, '').selectedProgram).toBe('ตรวจเข่า');
    const answer = await runWosAI(input, history, { conversationId: 'mock-conversation' });
    expect(mocks.search).not.toHaveBeenCalled();
    expect(answer).not.toContain('ตรวจเข่า');
    expect(answer).toContain('โปรแกรม');
    const state = deriveWosJourneyState(history, input);
    expect(state.selectedProgram).toBeUndefined();
    expect(state.selectedProvider).toBeUndefined();
    expect(state.answeredQuestion).toBeUndefined();
    expect(slots(history, input)).toEqual(slots(history));
    expect(isHandoffConfirmation(input)).toBe(false);
    expect(isJourneyReady(state)).toBe(false);
    expect(getWosConciergeStage(state)).not.toBe('awaiting_confirmation');
    expect(history).toEqual(original);
    noExternalWork();
  });

  it('cannot revive a rejected selection through summary recovery, thanks, or later confirmation', async () => {
    const answer = await runWosAI('ไม่เอาตรวจเข่า', history);
    let h = append(history, 'ไม่เอาตรวจเข่า', answer);
    for (const input of ['ขอบคุณ ຫຼາຍ', 'ยืนยัน', 'ยืนยัน']) {
      const reply = await runWosAI(input, h, { conversationId: 'mock-conversation' });
      h = append(h, input, reply);
      const state = deriveWosJourneyState(h, '');
      expect(state.selectedProgram).toBeUndefined();
      expect(isJourneyReady(state)).toBe(false);
      expect(reply).not.toContain('ตรวจเข่า');
      expect(slots(h)).toEqual(slots(history));
    }
    noExternalWork();
  });

  it('does not fall back to a trip handoff when unrelated complete trip slots exist', async () => {
    const h: WosAIHistoryMessage[] = [
      { role: 'user', content: 'ไปอุดร วันที่ 2026-12-01 มี 2 คน' }, ...history,
    ];
    const state = deriveWosJourneyState(h, 'ไม่เอาตรวจเข่า');
    expect(state).toMatchObject({ destination: 'อุดรธานี', serviceDate: '2026-12-01', travelers: 2 });
    expect(state.selectedProgram).toBeUndefined();
    expect(isJourneyReady(state)).toBe(false);
    expect(getWosConciergeStage(state)).toBe('collecting_booking');
  });

  it('does not treat a named rejection without selection as a positive lookup', async () => {
    const answer = await runWosAI('ไม่เอาตรวจเข่า', []);
    expect(answer).not.toContain('ตรวจเข่า');
    expect(answer).toContain('โปรแกรม');
    expect(deriveWosJourneyState([], 'ไม่เอาตรวจเข่า').selectedProgram).toBeUndefined();
    noExternalWork();
  });

  it('rejecting B preserves selected A and does not select B from an old catalog', async () => {
    const h: WosAIHistoryMessage[] = [
      { role: 'assistant', content: '1. ตรวจเข่า — Fixture\n2. ฟื้นฟูข้อเท้า — Fixture' }, ...history,
    ];
    const answer = await runWosAI('ไม่เอาฟื้นฟูข้อเท้า', h);
    expect(deriveWosJourneyState(h, 'ไม่เอาฟื้นฟูข้อเท้า').selectedProgram).toBe('ตรวจเข่า');
    expect(deriveWosJourneyState(append(h, 'ไม่เอาฟื้นฟูข้อเท้า', answer), 'ขอบคุณ').selectedProgram).toBe('ตรวจเข่า');
    expect(slots(h, 'ไม่เอาฟื้นฟูข้อเท้า')).toEqual(slots(h));
    noExternalWork();
  });

  it.each([
    ['ไม่เอาตรวจเข่า', 'ตรวจเข่า'],
    ['ບໍ່ເອົາตรวจเข่า', 'ตรวจเข่า'],
    ['ไม่เอาກວດເຂົ່າ', 'ตรวจเข่า'],
    ['ບໍ່ຕ້ອງການກວດເຂົ່າ', 'ตรวจเข่า'],
    ['ไม่สนใจฟื้นฟูข้อเท้าค่ะ', 'ฟื้นฟูข้อเท้า'],
    ['do not want ฟื้นฟูข้อเท้า', 'ฟื้นฟูข้อเท้า'],
  ])('uses shared negative semantics for %s', async (input, title) => {
    const h = history.map(m => ({ ...m, content: m.content.replaceAll('ตรวจเข่า', title) }));
    const answer = await runWosAI(input, h);
    expect(deriveWosJourneyState(h, input).selectedProgram).toBeUndefined();
    expect(deriveWosJourneyState(append(h, input, answer), 'ยืนยัน').selectedProgram).toBeUndefined();
    expect(slots(h, input)).toEqual(slots(h));
    noExternalWork();
  });

  it('does not capture a rejected program as the pending name or pickup', async () => {
    for (const h of [history.slice(0, 2), append(history.slice(0, 4), 'สนใจ', 'ขอจุดรับด้วยนะคะ')]) {
      const before = slots(h);
      const answer = await runWosAI('ไม่เอาตรวจเข่า', h);
      expect(slots(h, 'ไม่เอาตรวจเข่า')).toEqual(before);
      expect(deriveWosJourneyState(append(h, 'ไม่เอาตรวจเข่า', answer), '').activePendingQuestion).toBeUndefined();
      expect(classifyAssistantQuestion(answer)).toBeUndefined();
    }
    noExternalWork();
  });

  it('allows positive replacement and explicit reselection after rejection', async () => {
    const rejected = append(history, 'ไม่เอาตรวจเข่า', await runWosAI('ไม่เอาตรวจเข่า', history));
    for (const title of ['ตรวจสุขภาพ', 'ตรวจเข่า', 'ฟื้นฟูข้อเท้า']) {
      const input = 'เลือก' + title;
      const answer = await runWosAI(input, rejected);
      expect(mocks.search).toHaveBeenCalledWith(title, 3);
      expect(deriveWosJourneyState(append(rejected, input, answer), '').selectedProgram).toBe(title);
    }
  });

  it('keeps bare and explicit addon declines bound to the existing addon contract', async () => {
    for (const input of ['ไม่เอา', 'ไม่เอารถรับส่ง', 'ບໍ່ຕ້ອງການລົດຮັບສົ່ງ']) {
      const h = history.slice(0, 4);
      const answer = await runWosAI(input, h);
      expect(deriveWosJourneyState(h, input)).toMatchObject({ selectedProgram: 'ตรวจเข่า', transportNeeded: false, answeredQuestion: 'transport' });
      expect(classifyAssistantQuestion(answer)).toBe('hotel');
    }
    const h = history.slice(0, 6);
    expect(deriveWosJourneyState(h, 'ไม่เอาโรงแรม')).toMatchObject({ selectedProgram: 'ตรวจเข่า', hotelNeeded: false, answeredQuestion: 'hotel' });
  });

  it('retains R41 acknowledgement before every external operation', async () => {
    expect(await runWosAI('ขอบคุณ ຫຼາຍ', history)).toBe('ยินดีมากค่ะ 😊');
    expect(slots(history, 'ขอบคุณ ຫຼາຍ')).toEqual(slots(history));
    noExternalWork();
  });
});
