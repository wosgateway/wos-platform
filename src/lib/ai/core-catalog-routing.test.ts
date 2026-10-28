import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWosAI, type WosAIHistoryMessage } from './core';
import * as programs from './programs';
import { classifyAssistantQuestion, deriveWosJourneyState } from './journey-state';

const db = vi.hoisted(() => ({ rpc: vi.fn(), browse: vi.fn() }));
// Keep programs.ts AND data.ts real; fixtures replace only Supabase I/O.
vi.mock('@/lib/supabase/server', () => ({
  createAnonClient: () => ({
    rpc: db.rpc,
    from: (table: string) => {
      if (table !== 'packages') throw new Error(`Unexpected table: ${table}`);
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: db.browse,
      };
      return query;
    },
  }),
}));
vi.mock('./understanding/gate', () => ({ runUnderstandingGate: async () => ({ handled: false }) }));
vi.mock('./notion-knowledge', () => ({ searchWosNotionKnowledge: async () => [] }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => { throw new Error('Unexpected service database access'); } }));
vi.mock('openai', () => ({ default: class { constructor() { throw new Error('Unexpected LLM fallback'); } } }));


function row(id: string, title: string, province: string, provider: string) {
  return { id, title, special_price: 1500, status: 'published', is_active: true,
    partner_id_out: id, partner_name: provider, partner_category: 'clinic',
    partner_status: 'active', partner_province: province,
    partners: { id, name: provider, category: 'clinic', status: 'active', province } };
}
const health = row('health-udon', 'ตรวจสุขภาพ Health Udon', 'อุดรธานี', 'Health Udon');
const knee = row('knee-udon', 'ตรวจเข่า Knee Udon', 'อุดรธานี', 'Knee Udon');
const otherHealth = row('health-nongkhai', 'ตรวจสุขภาพ Health Nongkhai', 'หนองคาย', 'Health Nongkhai');
const hotel = row('hotel', 'โรงแรมห้องพัก', 'อุดรธานี', 'Hotel Udon');
let inventory = [health, knee, otherHealth, hotel];
beforeEach(() => {
  vi.restoreAllMocks(); inventory = [health, knee, otherHealth, hotel];
  // Deliberately return fuzzy/unrelated and cross-province rows: real search must filter them.
  db.rpc.mockReset().mockImplementation(async () => ({ data: inventory, error: null }));
  db.browse.mockReset().mockImplementation(async () => ({ data: inventory, error: null }));
});
describe('specific catalog routing with real query preparation and relevance filtering', () => {
  it.each([
    ['มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม', 'ตรวจสุขภาพ', 'อุดรธานี', 'Health Udon', 'Knee Udon', 'Health Nongkhai'],
    ['มีโปรแกรมตรวจสุขภาพในจังหวัดหนองคายไหม', 'ตรวจสุขภาพ', 'หนองคาย', 'Health Nongkhai', 'Health Udon', 'Knee Udon'],
    ['มีโปรแกรมตรวจเข่าในจังหวัดอุดรธานีไหม', 'ตรวจเข่า', 'อุดรธานี', 'Knee Udon', 'Health Udon', 'Health Nongkhai'],
    ['อุดรธานีมีโปรแกรมตรวจสุขภาพอะไรบ้าง', 'ตรวจสุขภาพ', 'อุดรธานี', 'Health Udon', 'Knee Udon', 'Health Nongkhai'],
  ])('%s searches both service and province', async (message, service, province, expected, excluded, otherProvince) => {
    const search = vi.spyOn(programs, 'searchPrograms');
    const overview = vi.spyOn(programs, 'searchHealthProgramOverview');
    const coverage = vi.spyOn(programs, 'getCatalogProvinces');
    const answer = await runWosAI(message, []);
    expect(search).toHaveBeenCalled();
    expect(search.mock.calls.some(([query]) => query.includes(service) && query.includes(province))).toBe(true);
    expect(db.rpc.mock.calls.some(([, args]) => args.search_term.includes(service))).toBe(true);
    expect(answer).toContain(expected); expect(answer).toContain(province);
    expect(answer).not.toContain(excluded); expect(answer).not.toContain(otherProvince);
    expect(answer).not.toContain('Hotel Udon');
    expect(overview).not.toHaveBeenCalled(); expect(coverage).not.toHaveBeenCalled();
  });
  it('searches a service without inventing a province', async () => {
    const search = vi.spyOn(programs, 'searchPrograms');
    const overview = vi.spyOn(programs, 'searchHealthProgramOverview');
    const message = 'มีโปรแกรมตรวจสุขภาพไหม'; const answer = await runWosAI(message, []);
    expect(search).toHaveBeenCalledWith(message, 5);
    expect(answer).toContain('Health Udon'); expect(answer).toContain('Health Nongkhai');
    expect(answer).not.toContain('Knee Udon'); expect(overview).not.toHaveBeenCalled();
  });
  it.each(['WOS มีบริการจังหวัดไหนบ้าง', 'มีจังหวัดอะไรบ้าง', 'ให้บริการจังหวัดไหน', 'ตอนนี้มีบริการกี่จังหวัด'])('%s preserves coverage', async message => {
    const coverage = vi.spyOn(programs, 'getCatalogProvinces');
    const search = vi.spyOn(programs, 'searchPrograms');
    const answer = await runWosAI(message, []);
    expect(coverage).toHaveBeenCalledOnce(); expect(search).not.toHaveBeenCalled();
    expect(answer).toContain('อุดรธานี'); expect(answer).toContain('หนองคาย');
  });
  it('preserves province discovery and excludes hotels and other provinces', async () => {
    const overview = vi.spyOn(programs, 'searchHealthProgramOverview');
    const answer = await runWosAI('อุดรธานีมีโปรแกรมอะไรบ้าง', []);
    expect(overview).toHaveBeenCalledWith(5, 'อุดรธานี');
    expect(answer).toContain('Health Udon'); expect(answer).toContain('Knee Udon');
    expect(answer).not.toContain('Health Nongkhai'); expect(answer).not.toContain('Hotel Udon');
  });
  it('keeps an absent service constrained instead of substituting overview inventory', async () => {
    inventory = [knee, otherHealth, hotel];
    const search = vi.spyOn(programs, 'searchPrograms');
    const overview = vi.spyOn(programs, 'searchHealthProgramOverview');
    const answer = await runWosAI('มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม', []);
    expect(search).toHaveBeenCalled(); expect(overview).not.toHaveBeenCalled();
    expect(answer).toContain('ไม่พบ'); expect(answer).toContain('อุดรธานี');
    for (const item of inventory) expect(answer).not.toContain(item.partner_name);
  });
});


describe('Thai/Lao catalog parity', () => {
  const healthUdon = 'ມີໂປຣແກຣມກວດສຸຂະພາບຢູ່ແຂວງອຸດອນທານີບໍ';
  it.each([
    [healthUdon, 'อุดรธานี', 'health-udon'],
    ['ມີໂປຣແກຣມກວດສຸຂະພາບຢູ່ໜອງຄາຍບໍ', 'หนองคาย', 'health-nongkhai'],
    ['ອຸດອນທານີມີໂປຣແກຣມກວດສຸຂະພາບຫຍັງແດ່', 'อุดรธานี', 'health-udon'],
    ['ມີໂປຣແກຣມກວດສຸຂະພາບຢູ່ อุดรธานี ບໍ', 'อุดรธานี', 'health-udon'],
    ['ມີໂປຣແກຣມກວດສຸຂະພາບຢູ່ Udon Thani ບໍ', 'อุดรธานี', 'health-udon'],
    ['ມີໂປຣແກຣມ ตรวจสุขภาพ ຢູ່ Udon Thani ບໍ', 'อุดรธานี', 'health-udon'],
    ['ມີໂປຣແກຣມ ตรวจสุขภาพ ຢູ່ອຸດອນທານີບໍ', 'อุดรธานี', 'health-udon'],
  ])('%s retains canonical service and location through real search', async (message, province, id) => {
    const prepared = programs.prepareCatalogQuery(message);
    expect(prepared.kind).toBe('specific'); expect(prepared.service).toBe('ตรวจสุขภาพ'); expect(prepared.locationAliases[0]).toBe(province);
    expect(prepared.serviceCandidates.some(c => c.value === 'ตรวจสุขภาพ')).toBe(true);
    const search=vi.spyOn(programs,'searchPrograms'), overview=vi.spyOn(programs,'searchHealthProgramOverview'), coverage=vi.spyOn(programs,'getCatalogProvinces');
    const answer=await runWosAI(message,[]);
    expect(search).toHaveBeenCalled(); expect(overview).not.toHaveBeenCalled(); expect(coverage).not.toHaveBeenCalled();
    const rows=await search.mock.results.at(-1)!.value;
    expect(rows.map((r: programs.ProgramSearchResult)=>r.id)).toEqual([id]);
    expect(answer).toContain(id==='health-udon'?'Health Udon':'Health Nongkhai');
    expect(answer).not.toContain('Knee Udon'); expect(answer).not.toContain('Hotel Udon');
  });
  it.each(['WOS ມີບໍລິການຢູ່ແຂວງໃດແດ່','ຕອນນີ້ມີບໍລິການຈັກແຂວງ'])('%s uses coverage rather than service search',async message=>{
    const coverage=vi.spyOn(programs,'getCatalogProvinces'), search=vi.spyOn(programs,'searchPrograms');
    const answer=await runWosAI(message,[]); expect(coverage).toHaveBeenCalledOnce();expect(search).not.toHaveBeenCalled();
    expect(answer).toContain('อุดรธานี');expect(answer).toContain('หนองคาย');
  });
  it('keeps a service without a province unscoped',async()=>{
    const message='ມີໂປຣແກຣມກວດສຸຂະພາບບໍ';
    expect(programs.prepareCatalogQuery(message).locationAliases).toEqual([]);
    const search=vi.spyOn(programs,'searchPrograms'),overview=vi.spyOn(programs,'searchHealthProgramOverview');
    const answer=await runWosAI(message,[]);expect(search).toHaveBeenCalled();expect(overview).not.toHaveBeenCalled();
    expect((await search.mock.results.at(-1)!.value).map((r:programs.ProgramSearchResult)=>r.id)).toEqual(['health-udon','health-nongkhai']);
    expect(answer).toContain('Health Udon');expect(answer).toContain('Health Nongkhai');expect(answer).not.toContain('Knee Udon');
  });
  it('discovers only Udon health programs',async()=>{
    const message='ອຸດອນທານີມີໂປຣແກຣມຫຍັງແດ່';
    expect(programs.prepareCatalogQuery(message).kind).toBe('discovery');
    const overview=vi.spyOn(programs,'searchHealthProgramOverview');const answer=await runWosAI(message,[]);
    expect(overview).toHaveBeenCalledWith(5,'อุดรธานี');
    expect(answer).toContain('Health Udon');expect(answer).toContain('Knee Udon');expect(answer).not.toContain('Health Nongkhai');expect(answer).not.toContain('Hotel Udon');
  });
  it('returns a constrained empty result rather than other services or provinces',async()=>{
    inventory=[knee,otherHealth,hotel];const search=vi.spyOn(programs,'searchPrograms'),overview=vi.spyOn(programs,'searchHealthProgramOverview');
    const answer=await runWosAI(healthUdon,[]);expect(search).toHaveBeenCalled();expect(await search.mock.results.at(-1)!.value).toEqual([]);
    expect(overview).not.toHaveBeenCalled();for(const item of inventory)expect(answer).not.toContain(item.partner_name);
    expect(answer).toContain('อุดรธานี');
  });
  it.each([
    ['ອຸດອນທານີ','อุดรธานี'],['ອຸດອນ','อุดรธานี'],['ອຸດອນທານິ','อุดรธานี'],['Udon Thani','อุดรธานี'],
    ['ໜອງຄາຍ','หนองคาย'],['ຫນອງຄາຍ','หนองคาย'],['ຫນອງຄາຽ','หนองคาย'],['Nong Khai','หนองคาย'],
  ])('%s resolves to %s without dropping the service',async (location,canonical)=>{
    const q='ມີກວດສຸຂະພາບຢູ່ '+location+' ບໍ';
    expect(programs.detectLocationFromRawText(q)[0]).toBe(canonical);
    const p=programs.prepareCatalogQuery(q);expect(p.locationAliases[0]).toBe(canonical);expect(p.serviceCandidates.some(c=>c.value==='ตรวจสุขภาพ')).toBe(true);
    const rows=await programs.searchPrograms(q);expect(rows.length).toBe(1);expect(rows[0].partner?.province).toBe(canonical);
  });
  it.each(['ມີໂປຣແກຣມກວດສຸຂະພາບຢູ່ແຂວງທີ່ບໍ່ຮູ້ຈັກບໍ','ມີໂປຣແກຣມກວດສຸຂະພາບຢູ່ສະຫວັນນະເຂດບໍ'])('does not broaden unresolved Lao location %s',async(q)=>{
    expect(await programs.searchPrograms(q)).toEqual([]);expect(db.rpc).not.toHaveBeenCalled();
    const answer=await runWosAI(q,[]);for(const item of inventory)expect(answer).not.toContain(item.partner_name);
  });
  it('does not turn an unknown Lao service into broad program inventory',async()=>{
    const answer=await runWosAI('ມີໂປຣແກຣມຟື້ນຟູພະລັງດາວອັງຄານຢູ່ອຸດອນບໍ',[]);
    for(const item of inventory)expect(answer).not.toContain(item.partner_name);expect(db.browse).not.toHaveBeenCalled();
  });
});


describe('existing Lao knee aliases converge on shared preparation',()=>{
  it.each(['ກວດເຂົ່າ','ກວດຫົວເຂົ່າ','ປວດຫົວເຂົ່າ','ເຈັບຫົວເຂົ່າ'])('%s retains the canonical service before search',async service=>{
    const message='ມີໂປຣແກຣມ '+service+' ຢູ່ອຸດອນທານີບໍ';
    const p=programs.prepareCatalogQuery(message);
    expect(p.kind).toBe('specific');expect(p.service).toBe('ตรวจเข่า');expect(p.locationAliases[0]).toBe('อุดรธานี');
    expect(p.serviceCandidates.some(c=>c.value==='ตรวจเข่า')).toBe(true);
    const rows=await programs.searchPrograms(message);expect(rows.map(r=>r.id)).toEqual(['knee-udon']);
    const answer=await runWosAI(message,[]);expect(answer).toContain('Knee Udon');expect(answer).not.toContain('Health Udon');expect(answer).not.toContain('Health Nongkhai');expect(answer).not.toContain('Hotel Udon');
  });
});
