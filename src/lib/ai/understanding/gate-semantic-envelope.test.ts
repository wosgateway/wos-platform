import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runUnderstandingGate } from './gate';
import { understand } from './understand';
import { runWosAI } from '../core';
import { buildProgramAnswer } from '../program-answer';
import type { Understanding } from './types';

const io = vi.hoisted(() => ({ model: vi.fn(), search: vi.fn(), provinces: vi.fn(), catalog: vi.fn(), log: vi.fn(), forbidden: vi.fn() }));
vi.mock('./understand', async original => {
  const actual = await original<typeof import('./understand')>();
  return { ...actual, understand: vi.fn(actual.understand) };
});
vi.mock('./llm', () => ({ createUnderstandLlm: () => io.model }));
vi.mock('./state', () => ({ loadProvinces: io.provinces, logAiRequest: io.log, loadState: io.forbidden, saveState: io.forbidden, clearState: io.forbidden }));
vi.mock('../programs', async original => ({ ...await original<typeof import('../programs')>(), searchPrograms: io.search, getCatalogProvinces: io.catalog, getProgramDetails: io.forbidden, searchHealthProgramOverview: io.forbidden }));
vi.mock('../notion-knowledge', () => ({ searchWosNotionKnowledge: io.forbidden }));
vi.mock('../hotel-availability', () => ({ searchHotelAvailability: io.forbidden }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: io.forbidden }));
vi.mock('@/lib/supabase/server', () => ({ createAnonClient: io.forbidden }));
vi.mock('openai', () => ({ default: class { constructor() { io.forbidden(); } } }));

const knee = { id: 'knee', title: 'ตรวจเข่า', special_price: 1500, partner: { name: 'Fixture', province: 'อุดรธานี' } };
const semantic = (intent: Understanding['intent']): Understanding => ({
  intent, confidence: 0.99, language: 'th', uses_context: false,
  entities: { province: null, program_query: intent === 'PROGRAM_SEARCH' ? 'ตรวจเข่า' : null, selection_index: null, detail_field: null },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WOS_AI_UNDERSTANDING', 'on');
  io.provinces.mockResolvedValue([{ id: 'udon', name_th: 'อุดรธานี', name_en: 'Udon Thani', name_lo: null, aliases: ['อุดร'] }]);
  io.catalog.mockResolvedValue(['อุดรธานี']);
  io.search.mockResolvedValue([knee]);
  io.log.mockResolvedValue(undefined);
  io.model.mockResolvedValue(JSON.stringify(semantic('GENERAL_QUESTION')));
  io.forbidden.mockImplementation(() => { throw new Error('Forbidden external operation'); });
});
afterEach(() => vi.unstubAllEnvs());

const gate = (userMessage: string) => runUnderstandingGate({ userMessage, history: [] });
async function expectTransport(result: Awaited<ReturnType<typeof gate>>, authority: 'observational' | 'authoritative') {
  expect(understand).toHaveBeenCalledOnce();
  const original = await vi.mocked(understand).mock.results[0].value;
  expect(result).toEqual({ handled: false, semantic: { authority, understanding: original.understanding } });
  if (!result.handled && result.semantic.authority !== 'none') {
    expect(result.semantic.understanding).toBe(original.understanding);
  }
}

describe('gate semantic envelope preserves invocation and authority', () => {
  it('off exposes none and performs no classification, model, data or telemetry work', async () => {
    vi.stubEnv('WOS_AI_UNDERSTANDING', 'off');
    expect(await gate('อยากตรวจเข่า')).toEqual({ handled: false, semantic: { authority: 'none' } });
    expect(understand).not.toHaveBeenCalled();
    for (const mock of Object.values(io)) expect(mock).not.toHaveBeenCalled();
  });
  it('shadow deterministic classification is observational without execution', async () => {
    vi.stubEnv('WOS_AI_UNDERSTANDING', 'shadow');
    await expectTransport(await gate('ปวดเข่า'), 'observational');
    expect(io.model).not.toHaveBeenCalled();
    expect(io.search).not.toHaveBeenCalled();
    expect(io.log).toHaveBeenCalledOnce();
  });
  it.each(['GENERAL_QUESTION', 'PROGRAM_SEARCH'] as const)('shadow model %s is observational only', async intent => {
    vi.stubEnv('WOS_AI_UNDERSTANDING', 'shadow');
    io.model.mockResolvedValue(JSON.stringify(semantic(intent)));
    await expectTransport(await gate(intent === 'PROGRAM_SEARCH' ? 'อยากตรวจเข่า' : 'ไม่ได้ถามเรื่องตรวจเข่า'), 'observational');
    expect(io.model).toHaveBeenCalledOnce();
    expect(io.search).not.toHaveBeenCalled();
    expect(io.log).toHaveBeenCalledOnce();
  });
  it('keeps two model attempts inside one understanding invocation', async () => {
    vi.stubEnv('WOS_AI_UNDERSTANDING', 'shadow');
    io.model.mockResolvedValueOnce('invalid JSON').mockResolvedValueOnce(JSON.stringify(semantic('GENERAL_QUESTION')));
    await expectTransport(await gate('ไม่ได้ถามเรื่องตรวจเข่า'), 'observational');
    expect(io.model).toHaveBeenCalledTimes(2);
    expect(io.search).not.toHaveBeenCalled();
  });
  it('on handled retains the original response shape and exact catalog text', async () => {
    const result = await gate('ปวดเข่า');
    expect(result).toEqual({ handled: true, text: buildProgramAnswer([knee], 'ปวดเข่า', '', 'th') });
    expect(understand).toHaveBeenCalledOnce();
    expect(io.model).not.toHaveBeenCalled();
    expect(io.search).toHaveBeenCalledWith('ตรวจเข่า', 5);
  });
  it('on deterministic DEFER transports the original classification', async () => {
    await expectTransport(await gate('โรงแรม'), 'authoritative');
    expect(io.model).not.toHaveBeenCalled();
    expect(io.search).not.toHaveBeenCalled();
  });
  it('on model DEFER transports hostile non-request classification unchanged', async () => {
    await expectTransport(await gate('ไม่ได้ถามเรื่องตรวจเข่า'), 'authoritative');
    expect(io.model).toHaveBeenCalledOnce();
    expect(io.search).not.toHaveBeenCalled();
    expect(io.log.mock.calls[0][0]).toMatchObject({ intent: 'GENERAL_QUESTION', action: 'DEFER' });
  });
  it.each(['', 'x'.repeat(401)])('input guard has no fabricated semantics', async message => {
    expect(await gate(message)).toEqual({ handled: false, semantic: { authority: 'none' } });
    expect(understand).not.toHaveBeenCalled();
    expect(io.model).not.toHaveBeenCalled();
  });
  it('missing provinces returns none before understanding', async () => {
    io.provinces.mockResolvedValueOnce([]);
    expect(await gate('อยากตรวจเข่า')).toEqual({ handled: false, semantic: { authority: 'none' } });
    expect(understand).not.toHaveBeenCalled();
    expect(io.model).not.toHaveBeenCalled();
  });
  it('failed model attempts do not fabricate an understanding', async () => {
    io.model.mockResolvedValue('invalid JSON');
    expect(await gate('ไม่ได้ถามเรื่องตรวจเข่า')).toEqual({ handled: false, semantic: { authority: 'none' } });
    expect(understand).toHaveBeenCalledOnce();
    expect(io.model).toHaveBeenCalledTimes(2);
  });
  it('on classification survives an execute error without retrying classification', async () => {
    io.search.mockRejectedValueOnce(new Error('fixture search failure'));
    await expectTransport(await gate('ปวดเข่า'), 'authoritative');
    expect(io.search).toHaveBeenCalledOnce();
    expect(io.model).not.toHaveBeenCalled();
  });
  it('on positive model classification still executes the existing search', async () => {
    io.model.mockResolvedValue(JSON.stringify(semantic('PROGRAM_SEARCH')));
    expect(await gate('อยากตรวจเข่า')).toEqual({ handled: true, text: buildProgramAnswer([knee], 'อยากตรวจเข่า', '', 'th') });
    expect(understand).toHaveBeenCalledOnce();
    expect(io.model).toHaveBeenCalledOnce();
    expect(io.search).toHaveBeenCalledWith('ตรวจเข่า', 5);
  });
  it.each(['off', 'shadow', 'on'])('core authorizes deferred hostile input without duplicate classification in %s', async mode => {
    vi.stubEnv('WOS_AI_UNDERSTANDING', mode);
    const message = 'ไม่ได้ถามเรื่องตรวจเข่า';
    expect(await runWosAI(message, [])).not.toContain('1. ตรวจเข่า');
    expect(io.search).not.toHaveBeenCalled();
    expect(understand).toHaveBeenCalledTimes(mode === 'off' ? 0 : 1);
    expect(io.model).toHaveBeenCalledTimes(mode === 'off' ? 0 : 1);
  });
});
