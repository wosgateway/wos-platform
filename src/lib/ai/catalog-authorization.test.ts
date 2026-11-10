import { describe, it, expect } from 'vitest';
import { authorizeCatalogTurn as authorize, provinceContinuation, pendingForExecution } from './catalog-authorization';
import { decide } from './understanding/orchestrator';
import { understand } from './understanding/understand';
import type { Understanding } from './understanding/types';
const udon = { id: 'udon', name_th: 'อุดรธานี', name_en: null, name_lo: 'ອຸດອນທານີ', aliases: ['อุดร'] };
const nong = { id: 'nong', name_th: 'หนองคาย', name_en: null, name_lo: null, aliases: [] };
const pending = { id: 'request-knee', query: 'ตรวจเข่า', source: 'explicit-service' as const, createdAt: '2026-10-26T00:00:00Z' };
const semantic = (intent: Understanding['intent']): Understanding => ({ intent, confidence: .99, language: 'th', uses_context: false, entities: { province: null, program_query: 'ตรวจเข่า', selection_index: null, detail_field: null } });
describe('isolated consumer ownership and exact pending execution', () => {
  it.each(['อยากตรวจเข่า', 'มีตรวจเข่าไหม', 'ปวดเข่า มีโปรแกรมอะไรที่เกี่ยวข้องไหม', 'ມີໂປຣແກຣມກວດເຂົ່າບໍ'])('authorizes a bounded actual request: %s', message => {
    expect(authorize({ message, owner: 'none' })).toMatchObject({ allowed: true, operation: 'search' });
  });
  it.each(['ปวดเข่า', 'ตรวจเข่า', 'ไม่ได้ถามเรื่องตรวจเข่า', 'ไม่เอาตรวจเข่า', 'ขอบคุณ'])('does not authorize evidence/non-request: %s', message => {
    expect(authorize({ message, owner: 'none', understanding: semantic('PROGRAM_SEARCH'), provenance: 'deterministic' }).allowed).toBe(false);
  });
  it.each(['rejection', 'non-request', 'deterministic-state', 'unresolved'] as const)('prior owner %s vetoes positive syntax', owner => {
    expect(authorize({ message: 'อยากตรวจเข่า', owner }).allowed).toBe(false);
  });
  it('selection retains its operation despite a hostile search classification', () => {
    expect(authorize({ message: 'ເລືອກກວດເຂົ່າ', owner: 'selection', understanding: semantic('PROGRAM_SEARCH'), provenance: 'model' })).toMatchObject({ operation: 'selection', service: null });
  });
  it.each(['อุดรธานี', 'อุดรธานีครับ', 'จังหวัดอุดรธานีค่ะ', 'ແຂວງອຸດອນທານີ'])('accepts bounded province continuation: %s', message => {
    expect(provinceContinuation(message, [udon])).toEqual(udon);
  });
  it('does not steal arbitrary pickup or request text', () => {
    expect(provinceContinuation('รับที่อุดรธานีครับ', [udon])).toBeNull();
    expect(authorize({ message: 'อุดรธานี', owner: 'deterministic-state', pending, continuationProvince: udon }).allowed).toBe(false);
  });
  it('binds consumption to pending identity, query, province, and search operation', () => {
    const a = authorize({ message: 'อุดรธานีครับ', owner: 'province-continuation', pending, continuationProvince: udon });
    const action = { type: 'SEARCH', kind: 'search', query: pending.query, province: udon };
    expect(pendingForExecution(a, action)).toBe(pending.id);
    for (const other of [{ ...action, kind: 'more' }, { ...action, query: 'ตรวจสุขภาพ' }, { ...action, province: nong }, { type: 'DETAIL' }, { type: 'SELECT' }, { type: 'NO_COVERAGE' }]) expect(pendingForExecution(a, other)).toBeUndefined();
  });
  it('unrelated requests and MORE have no entitlement to older pending', () => {
    expect(authorize({ message: 'อยากตรวจสุขภาพ', owner: 'none', pending }).pendingExecution).toBeUndefined();
    expect(authorize({ message: 'มีอีกไหม', owner: 'none', pending, understanding: semantic('PROGRAM_MORE'), provenance: 'deterministic' })).toMatchObject({ operation: 'more', service: null });
  });
  it('explicit current province outranks persisted and stale model province', () => {
    const u = { ...semantic('PROGRAM_SEARCH'), entities: { ...semantic('PROGRAM_SEARCH').entities, province: nong.name_th } };
    const ctx = { recentCatalog: [], catalogOffset: 0, catalogQuery: null, selectedProgramId: null, journeyProvinceId: udon.id };
    expect(decide(u, 'มีตรวจเข่าไหม', ctx, { provinces: [udon, nong], coveredProvinceIds: new Set([udon.id, nong.id]) })).toMatchObject({ type: 'SEARCH', province: udon });
    expect(decide(u, 'มีตรวจเข่าในจังหวัดหนองคายไหม', ctx, { provinces: [udon, nong], coveredProvinceIds: new Set([udon.id, nong.id]) })).toMatchObject({ type: 'SEARCH', province: nong });
  });
  it('classifies bounded lookup with deterministic provenance', async () => {
    const llm = async () => { throw new Error('No model permitted'); };
    const result = await understand(llm, 'มีตรวจเข่าไหม', [], [], [udon]);
    expect(result.provenance).toBe('deterministic');
    expect(result.understanding?.intent).toBe('PROGRAM_SEARCH');
  });
});
