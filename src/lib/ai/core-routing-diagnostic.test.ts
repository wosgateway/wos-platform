import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runUnderstandingGate } from './understanding/gate';
import { runWosAI } from './core';
import { POST } from '@/app/api/ai/chat/route';

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
const correlationId = '8e47f815-09f2-4723-9ff2-b0b21dcaa391';
function understanding(intent: string, query: string | null = null) {
  return { understanding: { intent, confidence: 0.99, language: 'th', uses_context: true, entities: { province: null, program_query: query, selection_index: null, detail_field: null } } };
}
function request() {
  return new Request('http://local.invalid/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-wos-routing-diagnostic-id': correlationId }, body: JSON.stringify({ message: input, history }) });
}
beforeEach(() => {
  vi.stubEnv('WOS_AI_UNDERSTANDING', 'on');
  vi.stubEnv('VERCEL_ENV', 'preview');
  for (const mock of Object.values(io)) mock.mockReset();
  io.understand.mockResolvedValue(understanding('PROGRAM_SEARCH', 'private-query'));
  io.provinces.mockResolvedValue([{ id: 'udon', name_th: 'อุดรธานี', name_en: 'Udon Thani', aliases: ['อุดร'] }]);
  io.catalog.mockResolvedValue(['อุดรธานี']);
  io.search.mockResolvedValue([{ id: 'knee', title: 'ตรวจเข่า', special_price: 1500, original_price: 1900, is_promotion: true, partner: { name: 'PRIVATE PROVIDER', province: 'อุดรธานี' } }]);
  io.knowledge.mockResolvedValue([]);
  io.forbidden.mockImplementation(() => { throw new Error('Forbidden external operation'); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('temporary bounded gate observer', () => {
  it.each([
    ['PROGRAM_SEARCH', 'private-query', 'PROGRAM_SEARCH'],
    ['TRANSPORT', null, 'TRANSPORT'],
    ['PROGRAM_DISCOVERY', null, 'OTHER'],
  ])('observes actual %s decision without exposing its data', async (intent, query, category) => {
    io.understand.mockResolvedValue(understanding(intent, query));
    const observer = vi.fn();
    await runUnderstandingGate({ userMessage: input, history, onDiagnosticCategory: observer });
    expect(observer.mock.calls).toEqual([['NONE'], [category]]);
  });
  it('reports NONE when no decision is selected', async () => {
    vi.stubEnv('WOS_AI_UNDERSTANDING', 'off');
    const observer = vi.fn();
    expect(await runUnderstandingGate({ userMessage: input, history, onDiagnosticCategory: observer })).toEqual({ handled: false });
    expect(observer.mock.calls).toEqual([['NONE']]);
    expect(io.understand).not.toHaveBeenCalled();
  });
  it('has identical business results with absent, present and throwing observers', async () => {
    const args = { userMessage: input, history };
    const absent = await runUnderstandingGate(args);
    const present = await runUnderstandingGate({ ...args, onDiagnosticCategory: vi.fn() });
    const throwing = await runUnderstandingGate({ ...args, onDiagnosticCategory: () => { throw new Error('Observer failure'); } });
    expect(absent.handled).toBe(true);
    expect(present).toEqual(absent);
    expect(throwing).toEqual(absent);
    expect(io.search.mock.calls).toEqual(Array(3).fill(['private-query', 5]));
    expect(io.forbidden).not.toHaveBeenCalled();
  });
});

describe('request-correlated real core branch observation', () => {
  it('records the real positive-search gate return before concierge without changing business output or history', async () => {
    const before = structuredClone(history);
    const absent = await runWosAI(input, history);
    const observer = vi.fn();
    const present = await runWosAI(input, history, { routingDiagnostic: observer });
    const throwing = await runWosAI(input, history, { routingDiagnostic: () => { throw new Error('Observer failure'); } });
    expect(present).toBe(absent);
    expect(throwing).toBe(absent);
    expect(history).toEqual(before);
    expect(observer.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'evidence', pendingAnswer: true, negativeAnswer: true, thanks: false, namedRejection: false },
      { stage: 'gate.enter' }, { stage: 'gate.category', category: 'NONE' },
      { stage: 'gate.category', category: 'PROGRAM_SEARCH' },
      { stage: 'gate.result', handled: true, category: 'PROGRAM_SEARCH' },
      { stage: 'gate.return', handled: true, category: 'PROGRAM_SEARCH' },
    ]);
    expect(io.forbidden).not.toHaveBeenCalled();
  });
  it('observes transport deferral followed by selected lookup and concierge return', async () => {
    io.understand.mockResolvedValue(understanding('TRANSPORT'));
    const observer = vi.fn();
    const answer = await runWosAI(input, history, { routingDiagnostic: observer });
    expect(answer).toContain('โรงแรม');
    expect(observer.mock.calls.map(([e]) => e.stage)).toEqual(['evidence', 'gate.enter', 'gate.category', 'gate.category', 'gate.result', 'selected_lookup.enter', 'concierge.return']);
    expect(observer).toHaveBeenCalledWith({ stage: 'gate.result', handled: false, category: 'TRANSPORT' });
  });
  it('emits only UUID, ordered categorical fields; HTTP business result is unchanged when logging throws', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await POST(request());
    const body = await response.json();
    const rows = log.mock.calls.filter(([tag]) => tag === '[WOS_ROUTING_DIAGNOSTIC]').map(([, json]) => JSON.parse(String(json)));
    expect(rows[0]).toEqual({ correlationId, sequence: 1, stage: 'route.enter' });
    const allowed = ['correlationId', 'sequence', 'stage', 'pendingAnswer', 'negativeAnswer', 'thanks', 'namedRejection', 'handled', 'category'];
    for (const [index, row] of rows.entries()) {
      expect(row.correlationId).toBe(correlationId);
      expect(row.sequence).toBe(index + 1);
      expect(Object.keys(row).every(key => allowed.includes(key))).toBe(true);
    }
    for (const secret of [input, ...history.map(h => h.content), 'private-query', 'PRIVATE PROVIDER', '1500', '1900']) expect(JSON.stringify(rows)).not.toContain(secret);
    log.mockImplementation(() => { throw new Error('Logging unavailable'); });
    const failedLogResponse = await POST(request());
    expect(failedLogResponse.status).toBe(response.status);
    expect(await failedLogResponse.json()).toEqual(body);
    expect(io.forbidden).not.toHaveBeenCalled();
  });
});
