import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runUnderstandingGate } from './understanding/gate';
import { runWosAI } from './core';
import { classifyAssistantQuestion, deriveWosJourneyState } from './journey-state';

const io = vi.hoisted(() => ({ understand: vi.fn(), search: vi.fn(), provinces: vi.fn(), catalog: vi.fn(), log: vi.fn(), knowledge: vi.fn(), forbidden: vi.fn() }));
vi.mock('./understanding/understand', () => ({ understand: io.understand }));
vi.mock('./understanding/llm', () => ({ createUnderstandLlm: () => io.forbidden }));
vi.mock('./understanding/state', () => ({ loadProvinces: io.provinces, logAiRequest: io.log, loadState: io.forbidden, saveState: io.forbidden, clearState: io.forbidden }));
vi.mock('./programs', async original => ({ ...await original<typeof import('./programs')>(), searchPrograms: io.search, getCatalogProvinces: io.catalog, getProgramDetails: io.forbidden, searchHealthProgramOverview: io.forbidden }));
vi.mock('./notion-knowledge', () => ({ searchWosNotionKnowledge: io.knowledge }));
vi.mock('./hotel-availability', () => ({ searchHotelAvailability: io.forbidden }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: io.forbidden }));
vi.mock('@/lib/supabase/server', () => ({ createAnonClient: io.forbidden }));
vi.mock('@/lib/rate-limit', () => ({ simpleRateLimit: async () => ({ allowed: true }) }));
vi.mock('openai', () => ({ default: class { constructor() { io.forbidden(); } } }));

const input = 'ไม่ ขอบคุณครับ';
const history: { role: 'user' | 'assistant'; content: string }[] = [
  { role: 'user', content: 'เลือกตรวจเข่า' },
  { role: 'assistant', content: 'ได้เลยค่ะ 😊 ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ' },
  { role: 'user', content: 'WOS Preview Synthetic' },
  { role: 'assistant', content: 'รับทราบค่ะ 😊 สนใจรถรับส่งด้วยไหมคะ?' },
];
function understanding() {
  return { understanding: { intent: 'PROGRAM_SEARCH', confidence: 0.99, language: 'th', uses_context: true, entities: { province: null, program_query: 'ตรวจเข่า', selection_index: null, detail_field: null } } };
}
const knee = { id: 'knee', title: 'ตรวจเข่า', special_price: 1500, original_price: 1900, is_promotion: true, partner: { name: 'Fixture', province: 'อุดรธานี' } };
beforeEach(() => {
  vi.stubEnv('WOS_AI_UNDERSTANDING', 'on');
  for (const mock of Object.values(io)) mock.mockReset();
  io.understand.mockResolvedValue(understanding());
  io.provinces.mockResolvedValue([{ id: 'udon', name_th: 'อุดรธานี', name_en: 'Udon Thani', aliases: ['อุดร'] }]);
  io.catalog.mockResolvedValue(['อุดรธานี']);
  io.search.mockResolvedValue([knee]);
  io.knowledge.mockResolvedValue([]);
  io.forbidden.mockImplementation(() => { throw new Error('Forbidden external operation'); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function expectNoExternalWork() {
  for (const mock of Object.values(io)) expect(mock).not.toHaveBeenCalled();
}
const hotelHistory: typeof history = [...history,
  { role: 'user', content: 'ไม่เอารถ' },
  { role: 'assistant', content: 'รับทราบค่ะ 😊 สนใจโรงแรมด้วยไหมคะ?' },
];
const pickupHistory: typeof history = [...history,
  { role: 'user', content: 'เอารถด้วย' },
  { role: 'assistant', content: 'ได้เลยค่ะ 😊 ขอจุดรับด้วยนะคะ' },
];

describe('pending negative priority through actual core and actual understanding gate', () => {
  it('proves the hostile real gate produces a handled positive catalog with a nonempty catalog', async () => {
    const result = await runUnderstandingGate({ userMessage: input, history });
    expect(result.handled).toBe(true);
    if (result.handled) expect(result.text).toContain(knee.title);
    expect(io.search).toHaveBeenCalledWith('ตรวจเข่า', 5);
    expect(io.understand).toHaveBeenCalledOnce();
  });
  it.each(['ไม่ ขอบคุณครับ', 'ไม่เอาครับ', 'ไม่เอารถ'])('resolves pending transport %s before hostile gate and preserves state', async message => {
    const h = structuredClone(history), before = structuredClone(h);
    const state = deriveWosJourneyState(h, message);
    expect(state).toMatchObject({ selectedProgram: 'ตรวจเข่า', activePendingQuestion: 'transport', transportNeeded: false });
    const answer = await runWosAI(message, h);
    expect(answer).toBe('รับทราบค่ะ 😊 สนใจโรงแรมด้วยไหมคะ?');
    expect(classifyAssistantQuestion(answer)).toBe('hotel');
    const replay = deriveWosJourneyState([...h, { role: 'user', content: message }, { role: 'assistant', content: answer }], '');
    expect(replay).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'WOS Preview Synthetic', transportNeeded: false });
    expect(replay.rejectedProgram).toBeUndefined();
    expect(h).toEqual(before);
    expectNoExternalWork();
  });
  it('resolves a pending hotel negative into the existing summary', async () => {
    const state = deriveWosJourneyState(hotelHistory, 'ไม่เอาครับ');
    expect(state).toMatchObject({ activePendingQuestion: 'hotel', answeredQuestion: 'hotel', hotelNeeded: false });
    const answer = await runWosAI('ไม่เอาครับ', hotelHistory);
    expect(answer).toContain('สรุป');
    expect(answer).toContain('โรงแรม: ไม่ต้องการ');
    expectNoExternalWork();
  });
  it('declines transport while pickup is pending without restarting pickup', async () => {
    expect(deriveWosJourneyState(pickupHistory, 'ไม่เอาครับ')).toMatchObject({ activePendingQuestion: 'pickup', answeredQuestion: 'transport', transportNeeded: false });
    expect(classifyAssistantQuestion(await runWosAI('ไม่เอาครับ', pickupHistory))).toBe('hotel');
    expectNoExternalWork();
  });
  it('preserves both explicit addon preferences in a compound negative turn', async () => {
    const message = 'ไม่เอารถ แต่ขอโรงแรมด้วย';
    expect(deriveWosJourneyState(history, message)).toMatchObject({ transportNeeded: false, hotelNeeded: true, currentTurnAddon: { transport: false, hotel: true } });
    const answer = await runWosAI(message, history);
    expect(answer).toContain('รถรับส่ง: ไม่ต้องการ');
    expect(answer).toContain('โรงแรม: ต้องการ');
    expectNoExternalWork();
  });
  it.each(['ไม่เอาตรวจเข่า', 'ไม่เอาตรวจสุขภาพ'])('retains named rejection priority for %s', async message => {
    const state = deriveWosJourneyState(history, message);
    if (message === 'ไม่เอาตรวจเข่า') expect(state.selectedProgram).toBeUndefined();
    else expect(state.selectedProgram).toBe('ตรวจเข่า');
    expect(await runWosAI(message, history)).toContain('สนใจโปรแกรมไหน');
    expectNoExternalWork();
  });
  it('keeps R41 deterministic and zero-external', async () => {
    const before = deriveWosJourneyState(history, '');
    const answer = await runWosAI('ขอบคุณ ຫຼາຍ', history);
    expect(answer).toBe('ยินดีมากค่ะ 😊');
    const after = deriveWosJourneyState([...history, { role: 'user', content: 'ขอบคุณ ຫຼາຍ' }, { role: 'assistant', content: answer }], '');
    const slots = (s: typeof before) => ({ program: s.selectedProgram, name: s.customerName, transport: s.transportNeeded, pickup: s.transportOrigin, hotel: s.hotelNeeded });
    expect(slots(after)).toEqual(slots(before));
    expectNoExternalWork();
  });
  it.each([
    ['ขอข้อมูลตรวจเข่า', []],
    ['ขอข้อมูลตรวจเข่า', history],
    ['ไม่เอาครับ', []],
  ] as const)('allows gate/search outside deterministic pending negatives: %s', async (message, h) => {
    expect(await runWosAI(message, [...h])).toContain(knee.title);
    expect(io.understand).toHaveBeenCalledOnce();
    expect(io.search).toHaveBeenCalledWith('ตรวจเข่า', 5);
  });
});
