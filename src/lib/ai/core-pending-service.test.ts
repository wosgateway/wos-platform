import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWosAI } from './core';
import { clearPendingService, loadState, replacePendingService, saveState, setCurrentProvince } from './understanding/state';
import * as authorization from './catalog-authorization';

const io = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), writes: [] as Record<string, unknown>[],
  search: vi.fn(), coverage: vi.fn(), model: vi.fn(), forbidden: vi.fn(), events: [] as string[] }));
const provinces = [
  { id: 'udon', name_th: 'อุดรธานี', name_lo: 'ອຸດອນທານີ', aliases: ['อุดร'] },
  { id: 'nongkhai', name_th: 'หนองคาย', aliases: [] },
];
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: (table: string) => {
  let id = '', request: string | undefined, patch: Record<string, unknown> | undefined, remove = false;
  const q = {
    select: () => q,
    eq: (key: string, value: string) => { if (key === 'conversation_id') id = value; if (key === 'pending_request_id') request = value; return q; },
    maybeSingle: async () => ({ data: io.rows.get(id) ?? null, error: null }),
    upsert: async (row: Record<string, unknown>) => {
      io.events.push('persist'); io.writes.push(row);
      const key = row.conversation_id as string;
      io.rows.set(key, { ...(io.rows.get(key) ?? {}), ...row }); return { error: null };
    },
    update: (row: Record<string, unknown>) => { patch = row; return q; },
    delete: () => { remove = true; return q; },
    insert: async () => ({ error: null }),
    then: (resolve: (value: unknown) => unknown) => {
      if (table === 'provinces') return Promise.resolve(resolve({ data: provinces, error: null }));
      const old = io.rows.get(id);
      if (old && (!request || request === old.pending_request_id)) {
        if (remove) io.rows.delete(id);
        else if (patch) { io.writes.push(patch); io.rows.set(id, { ...old, ...patch }); }
      }
      return Promise.resolve(resolve({ error: null }));
    },
  }; return q;
} }) }));
vi.mock('./programs', async original => ({ ...await original<typeof import('./programs')>(),
  searchPrograms: io.search, getCatalogProvinces: io.coverage,
  searchHealthProgramOverview: io.forbidden, getProgramDetails: io.forbidden,
}));
vi.mock('./understanding/llm', () => ({ createUnderstandLlm: () => io.model }));
vi.mock('./notion-knowledge', () => ({ searchWosNotionKnowledge: io.forbidden }));
vi.mock('./hotel-availability', () => ({ searchHotelAvailability: io.forbidden }));
vi.mock('@/lib/supabase/server', () => ({ createAnonClient: io.forbidden }));
vi.mock('openai', () => ({ default: class { constructor() { io.forbidden(); } } }));

const result = { id: 'knee', title: 'ตรวจเข่า', special_price: 1000, partner: { name: 'Fixture', province: 'อุดรธานี' } };
const run = (text: string) => runWosAI(text, [], { conversationId: 'web:test', channel: 'web' });
const pending = () => io.rows.get('web:test')?.pending_request_id;
beforeEach(() => {
  vi.clearAllMocks(); io.rows.clear(); io.writes.length = 0; io.events.length = 0;
  vi.stubEnv('WOS_AI_UNDERSTANDING', 'on');
  io.search.mockImplementation(async () => { io.events.push('search'); return [result]; });
  io.coverage.mockResolvedValue(['อุดรธานี', 'หนองคาย']);
  io.model.mockRejectedValue(new Error('No model permitted'));
  io.forbidden.mockImplementation(() => { throw new Error('Forbidden external operation'); });
});
afterEach(() => vi.unstubAllEnvs());

describe('actual core/gate/state pending service lifecycle with mocked adapters only', () => {
  it.each(['มีโปรแกรมตรวจเข่าในจังหวัดดาวอังคารไหม', 'อยากตรวจเข่าในจังหวัดดาวอังคาร', 'ມີໂປຣແກຣມກວດເຂົ່າຢູ່ແຂວງດາວອັງຄານບໍ'])('authorized unresolved request %s creates pending without catalog', async text => {
    expect(await run(text)).toMatch(/จังหวัด|ແຂວງ/);
    expect(pending()).toBeTruthy(); expect(io.rows.get('web:test')?.pending_service_query).toBe('ตรวจเข่า');
    expect(io.search).not.toHaveBeenCalled(); expect(io.coverage).not.toHaveBeenCalled();
  });
  it('continues the exact pending service on a province-only next turn and consumes after execution', async () => {
    await run('มีโปรแกรมตรวจเข่าในจังหวัดดาวอังคารไหม');
    const original = pending(); expect(original).toBeTruthy();
    io.search.mockImplementationOnce(async () => { expect(pending()).toBe(original); return [result]; });
    expect(await run('อุดรธานี')).toContain('ตรวจเข่า');
    expect(io.search).toHaveBeenCalledWith('ตรวจเข่า อุดรธานี', 5, { throwOnError: true });
    expect(pending()).toBeNull(); expect(io.rows.get('web:test')?.province_id).toBe('udon');
    expect(io.rows.get('web:test')?.catalog_query).toEqual({ query: 'ตรวจเข่า', provinceId: 'udon' });
    expect(io.rows.get('web:test')?.last_catalog).toEqual([result]);
  });
  it.each(['province', 'error'] as const)('retains pending on %s', async failure => {
    await run('มีโปรแกรมตรวจเข่าในจังหวัดดาวอังคารไหม'); const original = pending();
    if (failure === 'province') await run('จังหวัดดาวอังคาร');
    else {
      io.search.mockRejectedValueOnce(new Error('fixture failure'));
      await run('อุดรธานี');
      expect(io.rows.get('web:test')?.province_id).toBe('udon');
    }
    expect(pending()).toBe(original);
  });
  it('a successful empty search consumes pending; this is distinct from pre-execution no coverage', async () => {
    await run('มีโปรแกรมตรวจเข่าในจังหวัดดาวอังคารไหม');
    io.search.mockResolvedValueOnce([]); await run('อุดรธานี');
    expect(io.search).toHaveBeenCalled(); expect(pending()).toBeNull();
  });
  it('valid province with no coverage remains current and retains pending without search', async () => {
    await run('มีโปรแกรมตรวจเข่าในจังหวัดดาวอังคารไหม'); const original = pending();
    io.coverage.mockResolvedValue([]); await run('หนองคาย');
    expect(io.rows.get('web:test')?.province_id).toBe('nongkhai'); expect(pending()).toBe(original);
    expect(io.search).not.toHaveBeenCalled();
  });
  it.each(['ไม่เอาตรวจเข่า', 'ไม่เอาครับ', 'เริ่มใหม่'])('clears pending on %s without catalog', async text => {
    await run('มีโปรแกรมตรวจเข่าในจังหวัดดาวอังคารไหม');
    await run(text); expect(pending() ?? null).toBeNull(); expect(io.search).not.toHaveBeenCalled();
  });
  it.each(['มีโปรแกรมตรวจสุขภาพบ้างไหม', 'ມີໂປຣແກຣມກວດສຸຂະພາບບໍ', 'ເລືອກກວດເຂົ່າ'])('preserves no-province lookup/selection %s', async text => {
    await run(text); expect(io.search).toHaveBeenCalled(); expect(pending() ?? null).toBeNull();
    expect(io.search.mock.calls.every(([query]) => !String(query).includes('อุดรธานี'))).toBe(true);
  });
  it.each(['จังหวัดดาวอังคาร', 'ไม่เอาตรวจเข่าในจังหวัดดาวอังคาร', 'ไม่เอาตรวจเข่าในจังหวัดอุดรธานี', 'ขอบคุณ ຫຼາຍ', 'ขอบคุณสำหรับตรวจเข่าในจังหวัดดาวอังคาร'])('does not create pending for %s', async text => {
    await run(text); expect(pending() ?? null).toBeNull(); expect(io.search).not.toHaveBeenCalled();
  });
  it('evaluates shared authorization before gate catalog metadata or search', async () => {
    const decision = vi.spyOn(authorization, 'authorizeCatalogTurn');
    try {
      await run('มีโปรแกรมตรวจเข่าในจังหวัดอุดรธานีไหม');
      expect(io.search).toHaveBeenCalled();
      expect(decision.mock.invocationCallOrder[0]).toBeLessThan(io.coverage.mock.invocationCallOrder[0]);
      expect(decision.mock.invocationCallOrder[0]).toBeLessThan(io.search.mock.invocationCallOrder[0]);
    } finally { decision.mockRestore(); }
  });
  it('uses current province for a later service request and preserves unrelated selected state', async () => {
    await saveState('web:test', 'web', { provinceId: 'udon', selectedProgramId: 'unrelated-selected' });
    await run('มีโปรแกรมตรวจเข่าไหม');
    expect(io.search).toHaveBeenCalledWith('ตรวจเข่า อุดรธานี', 5);
    expect(io.rows.get('web:test')?.selected_program_id).toBe('unrelated-selected');
  });
  it('scopes symptom lookup to the current province', async () => {
    await saveState('web:test', 'web', { provinceId: 'udon' });
    await run('ปวดเข่า มีโปรแกรมอะไรที่เกี่ยวข้องไหม');
    expect(io.search.mock.calls.some(([q]) => String(q).includes('อุดรธานี') && String(q).includes('เข่า'))).toBe(true);
  });
  it('retains an authorized symptom request through an unresolved province into a scoped search', async () => {
    await run('ปวดเข่า มีโปรแกรมอะไรที่เกี่ยวข้องไหม ในจังหวัดดาวอังคาร');
    expect(pending()).toBeTruthy(); expect(io.rows.get('web:test')?.pending_service_source).toBe('symptom');
    expect(io.search).not.toHaveBeenCalled();
    await run('อุดรธานี');
    expect(io.search.mock.calls.some(([q]) => String(q).includes('เข่า') && String(q).includes('อุดรธานี'))).toBe(true);
    expect(pending()).toBeNull();
  });
  it('invalid province retains the previous current province and pending request', async () => {
    await saveState('web:test', 'web', { provinceId: 'udon', selectedProgramId: 'selected' });
    await run('มีโปรแกรมตรวจเข่าในจังหวัดดาวอังคารไหม'); const original = pending();
    await run('จังหวัดดาวอังคาร');
    expect(io.rows.get('web:test')?.province_id).toBe('udon'); expect(pending()).toBe(original);
    expect(io.rows.get('web:test')?.selected_program_id).toBe('selected');
    expect(io.search).not.toHaveBeenCalled();
  });
  it('repeated valid province is not destructive while no coverage retains the pending request', async () => {
    await saveState('web:test', 'web', { provinceId: 'udon', selectedProgramId: 'selected' });
    await run('มีโปรแกรมตรวจเข่าในจังหวัดดาวอังคารไหม'); const original = pending();
    io.coverage.mockResolvedValue([]); await run('อุดรธานี'); await run('อุดรธานี');
    expect(pending()).toBe(original); expect(io.rows.get('web:test')?.selected_program_id).toBe('selected');
  });
  it('an explicit new unresolved request replaces the old pending query, not selection/catalog state', async () => {
    await run('มีโปรแกรมตรวจเข่าในจังหวัดดาวอังคารไหม'); const original = pending();
    await run('มีโปรแกรมตรวจสุขภาพในจังหวัดดาวอังคารไหม');
    expect(pending()).not.toBe(original); expect(io.rows.get('web:test')?.pending_service_query).toBe('ตรวจสุขภาพ');
  });
  it('retains pending on unrelated clarification and reads an old pending timestamp without TTL', async () => {
    await replacePendingService('web:test', 'web', { query: 'ตรวจเข่า', source: 'explicit-service' });
    const row = io.rows.get('web:test')!; row.pending_service_created_at = '2000-01-01T00:00:00Z';
    const original = pending(); await run('ขอถามเรื่องอื่นก่อน');
    expect(pending()).toBe(original); expect((await loadState('web:test'))?.pending?.createdAt).toBe('2000-01-01T00:00:00Z');
    expect(io.search).not.toHaveBeenCalled();
  });
  it('mixed Thai/Lao thanks preserves pending with zero state/catalog work', async () => {
    await replacePendingService('web:test', 'web', { query: 'ตรวจเข่า', source: 'explicit-service' });
    const before = structuredClone(io.rows.get('web:test')); const n = io.writes.length;
    expect(await run('ขอบคุณ ຫຼາຍ')).toMatch(/ยินดี|ຍິນດີ/);
    expect(io.rows.get('web:test')).toEqual(before); expect(io.writes.length).toBe(n);
    expect(io.search).not.toHaveBeenCalled(); expect(io.coverage).not.toHaveBeenCalled();
  });
  it('a province-shaped pickup answer remains owned by concierge and does not change catalog province', async () => {
    await saveState('web:test', 'web', { provinceId: 'udon' });
    await replacePendingService('web:test', 'web', { query: 'ตรวจเข่า', source: 'explicit-service' });
    const original = pending();
    const history = [
      { role: 'user' as const, content: 'เลือกตรวจเข่า' },
      { role: 'assistant' as const, content: 'ขอชื่อสำหรับลงข้อมูลด้วยค่ะ' },
      { role: 'user' as const, content: 'สมชาย' },
      { role: 'assistant' as const, content: 'สนใจรถรับส่งด้วยไหมคะ?' },
      { role: 'user' as const, content: 'เอารถด้วย' },
      { role: 'assistant' as const, content: 'ขอจุดรับด้วยนะคะ' },
    ];
    await runWosAI('หนองคาย', history, { conversationId: 'web:test', channel: 'web' });
    expect(io.rows.get('web:test')?.province_id).toBe('udon'); expect(pending()).toBe(original);
    expect(io.search).not.toHaveBeenCalled();
  });
  it('invalidates expired province-derived catalog without clearing selection or pending', async () => {
    await saveState('web:test', 'web', { provinceId: 'udon', catalogQuery: { provinceId: 'udon', query: 'old' }, lastCatalog: [result], selectedProgramId: 'selected' });
    io.rows.get('web:test')!.catalog_updated_at = '2000-01-01T00:00:00Z';
    await setCurrentProvince('web:test', 'web', await loadState('web:test'), 'nongkhai');
    expect(io.rows.get('web:test')?.catalog_query).toBeNull(); expect(io.rows.get('web:test')?.last_catalog).toEqual([]);
    expect(io.rows.get('web:test')?.selected_program_id).toBe('selected');
  });
  it('replaces pending atomically, has no TTL, preserves it during unrelated upsert and compare-clears only the right ID', async () => {
    const a = await replacePendingService('web:test', 'web', { query: 'ตรวจเข่า', source: 'explicit-service' });
    await saveState('web:test', 'web', { selectedProgramId: 'selected' });
    expect((await loadState('web:test'))?.pending?.id).toBe(a.id);
    const b = await replacePendingService('web:test', 'web', { query: 'ตรวจสุขภาพ', source: 'symptom' });
    expect(b.id).not.toBe(a.id); await clearPendingService('web:test', a.id); expect(pending()).toBe(b.id);
    expect(io.rows.get('web:test')?.selected_program_id).toBe('selected');
    await clearPendingService('web:test', b.id); expect(pending()).toBeNull();
    for (const row of io.writes.filter(row => 'pending_request_id' in row)) {
      expect(['pending_request_id', 'pending_service_query', 'pending_service_source', 'pending_service_created_at'].every(k => k in row)).toBe(true);
    }
  });
  it('province change invalidates only old province catalog; same province is a no-op', async () => {
    const request = await replacePendingService('web:test', 'web', { query: 'ตรวจเข่า', source: 'explicit-service' });
    await saveState('web:test', 'web', { provinceId: 'udon', catalogQuery: { provinceId: 'udon', query: 'old' }, lastCatalog: [result], selectedProgramId: 'selected' });
    let state = await loadState('web:test'); const n = io.writes.length;
    await setCurrentProvince('web:test', 'web', state, 'udon'); expect(io.writes.length).toBe(n);
    await setCurrentProvince('web:test', 'web', state, 'nongkhai'); state = await loadState('web:test');
    expect(state?.provinceId).toBe('nongkhai'); expect(state?.catalogQuery).toBeNull(); expect(state?.lastCatalog).toEqual([]);
    expect(state?.selectedProgramId).toBe('selected'); expect(state?.pending?.id).toBe(request.id);
  });
});

describe('shared eligibility remains separate from semantic evidence', () => {
  it.each(['ตรวจเข่า', 'เรื่องอื่น'])('evidence or a stored source cannot alone authorize %s', message => {
    const result = authorization.authorizeCatalogTurn({ message, owner: 'none',
      pending: { id: 'old', query: 'ตรวจเข่า', source: 'explicit-service', createdAt: '2000-01-01' } });
    expect(result.allowed).toBe(false);
  });
  it.each([0.3, Number.NaN, 2])('authoritative classification with confidence %s cannot be bypassed by deterministic wording', confidence => {
    expect(authorization.authorizeCatalogTurn({ message: 'อยากตรวจเข่า', owner: 'none', understanding: {
      intent: 'PROGRAM_SEARCH', confidence, language: 'th', uses_context: false,
      entities: { province: null, program_query: 'ตรวจเข่า', selection_index: null, detail_field: null },
    } }).allowed).toBe(false);
  });
});

describe('pending execution ownership regressions', () => {
  it('does not consume an older pending service when another service is searched', async () => {
    await replacePendingService('web:test', 'web', { query: 'ตรวจเข่า', source: 'explicit-service' });
    const original = pending();
    await run('มีโปรแกรมตรวจสุขภาพไหม');
    expect(io.search).toHaveBeenCalled();
    expect(pending()).toBe(original);
  });
  it.each(['อุดรธานีครับ', 'จังหวัดอุดรธานีค่ะ', 'ແຂວງອຸດອນທານີ'])('resumes only the exact pending service on decorated province %s', async province => {
    await replacePendingService('web:test', 'web', { query: 'ตรวจเข่า', source: 'explicit-service' });
    await run(province);
    expect(io.search).toHaveBeenCalledOnce();
    expect(io.search).toHaveBeenCalledWith('ตรวจเข่า อุดรธานี', 5, { throwOnError: true });
    expect(pending()).toBeNull();
  });
  it('does not consume pending when MORE replays an unrelated catalog', async () => {
    await replacePendingService('web:test', 'web', { query: 'ตรวจสุขภาพ', source: 'explicit-service' });
    const original = pending();
    await saveState('web:test', 'web', { provinceId: 'udon', lastCatalog: [result], catalogQuery: { query: 'ตรวจเข่า', provinceId: 'udon' }, catalogOffset: 1 });
    await runWosAI('มีอีกไหม', [{ role: 'assistant', content: '1. ตรวจเข่า' }], { conversationId: 'web:test', channel: 'web' });
    expect(io.search).toHaveBeenCalled();
    expect(pending()).toBe(original);
  });
});
