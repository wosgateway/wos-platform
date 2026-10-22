import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWosAI, type WosAIHistoryMessage } from './core';
import { classifyAssistantQuestion, deriveWosJourneyState, isThanksMessage, type WosJourneyState } from './journey-state';

const adapters = vi.hoisted(() => ({
  gate: vi.fn(), knowledge: vi.fn(), search: vi.fn(), overview: vi.fn(),
  provinces: vi.fn(), details: vi.fn(), hotel: vi.fn(), database: vi.fn(), model: vi.fn(),
}));
vi.mock('./understanding/gate', () => ({ runUnderstandingGate: adapters.gate }));
vi.mock('./notion-knowledge', () => ({ searchWosNotionKnowledge: adapters.knowledge }));
vi.mock('./programs', async importOriginal => ({
  ...await importOriginal<typeof import('./programs')>(),
  searchPrograms: adapters.search, searchHealthProgramOverview: adapters.overview,
  getCatalogProvinces: adapters.provinces, getProgramDetails: adapters.details,
}));
vi.mock('./hotel-availability', () => ({ searchHotelAvailability: adapters.hotel }));
vi.mock('@/lib/supabase/server', () => ({ createAnonClient: adapters.database }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: adapters.database }));
vi.mock('openai', () => ({ default: class { constructor() { adapters.model(); } } }));

// Exact eight-message history from release-eval/live-transcripts.jsonl, R41/T5.
// Kept inline so the regression does not depend on a host-specific evidence path.
const r41History: WosAIHistoryMessage[] = [
  { role: 'user', content: 'เลือกตรวจเข่า' },
  { role: 'assistant', content: 'ได้เลยค่ะ 😊 ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ' },
  { role: 'user', content: 'ສົມຊາຍ' },
  { role: 'assistant', content: 'รับทราบค่ะ 😊 สนใจรถรับส่งด้วยไหมคะ?' },
  { role: 'user', content: 'ບໍ່ຕ້ອງການລົດຮັບສົ່ງ' },
  { role: 'assistant', content: 'ຮັບຊາບຄ່ະ 😊 ສົນໃຈໂຮງແຮມນຳບໍຄ່ະ?' },
  { role: 'user', content: 'ไม่เอาโรงแรม' },
  { role: 'assistant', content: 'สรุปข้อมูลให้ทีม WOS นะคะ 😊\n\n• โปรแกรม: ตรวจเข่า\n• ชื่อผู้จอง: ສົມຊາຍ\n• รถรับส่ง: ไม่ต้องการ\n• โรงแรม: ไม่ต้องการ\n\nใบเฟิร์นจะประสานทีม WOS ต่อให้ค่ะ แล้วทีมงานจะติดต่อกลับเพื่อยืนยันรายละเอียดที่เหลือนะคะ' },
];
const TH = 'ยินดีมากค่ะ 😊';
const append = (h: WosAIHistoryMessage[], input: string, answer: string): WosAIHistoryMessage[] =>
  [...h, { role: 'user', content: input }, { role: 'assistant', content: answer }];
const slots = (s: WosJourneyState) => ({
  selectedProgram: s.selectedProgram, customerName: s.customerName,
  transportNeeded: s.transportNeeded, transportOrigin: s.transportOrigin, hotelNeeded: s.hotelNeeded,
  origin: s.origin, destination: s.destination, serviceDate: s.serviceDate,
  travelers: s.travelers, budgetThb: s.budgetThb,
});
function expectNoExternalWork() {
  for (const adapter of Object.values(adapters)) expect(adapter).not.toHaveBeenCalled();
}
beforeEach(() => {
  for (const adapter of Object.values(adapters)) adapter.mockReset();
  adapters.gate.mockResolvedValue({ handled: false });
  adapters.knowledge.mockResolvedValue([]);
  adapters.search.mockResolvedValue([]);
  adapters.overview.mockResolvedValue([]);
  adapters.provinces.mockResolvedValue([]);
  adapters.details.mockResolvedValue(null);
  adapters.hotel.mockImplementation(() => { throw new Error('Unexpected hotel lookup'); });
  adapters.database.mockImplementation(() => { throw new Error('Unexpected database access'); });
  adapters.model.mockImplementation(() => { throw new Error('Unexpected model access'); });
});

describe('early thanks acknowledgement through real runWosAI', () => {
  it('acknowledges exact historical R41/T5 without external work or slot changes', async () => {
    const input = 'ขอบคุณ ຫຼາຍ';
    const history = structuredClone(r41History);
    const original = structuredClone(history);
    const before = slots(deriveWosJourneyState(history, ''));
    expect(isThanksMessage(input)).toBe(true);
    const answer = await runWosAI(input, history);
    expect(answer).toBe(TH);
    expect(classifyAssistantQuestion(answer)).toBeUndefined();
    const after = slots(deriveWosJourneyState(append(history, input, answer), ''));
    expect(after).toEqual(before);
    expect(after).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'ສົມຊາຍ', transportNeeded: false, hotelNeeded: false });
    expect(history).toEqual(original);
    expectNoExternalWork();
  });

  it.each([
    ['Thai', 'ขอบคุณครับ', TH],
    ['Lao', 'ຂອບໃຈ', 'ດ້ວຍຄວາມຍິນດີຄ່ະ 😊'],
    ['English', 'thank you', 'You’re very welcome 😊'],
  ])('preserves %s thanks language', async (_language, input, expected) => {
    expect(await runWosAI(input, [])).toBe(expected);
    expectNoExternalWork();
  });

  it.each(['ຂອບໃຈ', 'thank you'])('preserves the pending-name language anchor for %s', async input => {
    const history = r41History.slice(0, 2);
    const answer = await runWosAI(input, history);
    expect(answer).toBe(TH);
    const state = deriveWosJourneyState(append(history, input, answer), 'สมชาย');
    expect(state).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย', activePendingQuestion: 'name' });
    expectNoExternalWork();
  });

  it('acknowledges repeated thanks without replaying intake or changing slots', async () => {
    let history = structuredClone(r41History);
    const before = slots(deriveWosJourneyState(history, ''));
    for (const input of ['ขอบคุณ', 'ขอบคุณครับ', 'ขอบคุณ ຫຼາຍ']) {
      const answer = await runWosAI(input, history);
      expect(answer).toBe(TH);
      expect(classifyAssistantQuestion(answer)).toBeUndefined();
      history = append(history, input, answer);
      expect(slots(deriveWosJourneyState(history, ''))).toEqual(before);
    }
    expectNoExternalWork();
  });

  it('still binds transparent ok to the pending transport question after thanks', async () => {
    const pending = r41History.slice(0, 4);
    const thanks = await runWosAI('ขอบคุณ', pending);
    expectNoExternalWork();
    const history = append(pending, 'ขอบคุณ', thanks);
    const answer = await runWosAI('ok', history);
    expect(deriveWosJourneyState(history, 'ok')).toMatchObject({ transportNeeded: true, answeredQuestion: 'transport', activePendingQuestion: 'transport' });
    expect(classifyAssistantQuestion(answer)).toBe('pickup');
    expect(answer).not.toBe(TH);
    expect(adapters.gate).toHaveBeenCalledOnce();
    expect(adapters.database).not.toHaveBeenCalled();
    expect(adapters.model).not.toHaveBeenCalled();
  });

  it('does not swallow mixed thanks and an explicit hotel request', async () => {
    const input = 'ขอบคุณ ผมสนใจโรงแรม';
    const history = r41History.slice(0, 4);
    expect(isThanksMessage(input)).toBe(false);
    const answer = await runWosAI(input, history);
    expect(answer).not.toBe(TH);
    expect(deriveWosJourneyState(history, input)).toMatchObject({ hotelNeeded: true, answeredQuestion: 'hotel' });
    expect(adapters.gate).toHaveBeenCalledOnce();
    expect(adapters.database).not.toHaveBeenCalled();
    expect(adapters.model).not.toHaveBeenCalled();
  });

  it('binds explicit negative plus thanks to transport instead of acknowledging it as thanks', async () => {
    const input = 'ไม่ ขอบคุณครับ';
    const history = r41History.slice(0, 4);
    expect(isThanksMessage(input)).toBe(false);
    const answer = await runWosAI(input, history);
    expect(answer).not.toBe(TH);
    expect(deriveWosJourneyState(history, input)).toMatchObject({ transportNeeded: false, answeredQuestion: 'transport' });
    expect(classifyAssistantQuestion(answer)).toBe('hotel');
    expect(adapters.gate).toHaveBeenCalledOnce();
    expect(adapters.database).not.toHaveBeenCalled();
    expect(adapters.model).not.toHaveBeenCalled();
  });
});
