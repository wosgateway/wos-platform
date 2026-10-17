import { describe, expect, it } from 'vitest';
import { catalogMatchesHistory, decide, type DecideContext } from './orchestrator';
import { coveredProvinceIds, detectProvinceInText, matchProvince, normalizeProvinceText, type ProvinceRecord } from './provinces';
import { extractJson, parseUnderstanding, type CatalogItem, type Understanding } from './types';

const P = (id: string, th: string, en: string, aliases: string[] = []): ProvinceRecord => ({ id, name_th: th, name_en: en, name_lo: null, aliases });
const provinces = [
  P('udon-thani', 'อุดรธานี', 'Udon Thani', ['อุดร', 'udon']),
  P('nong-khai', 'หนองคาย', 'Nong Khai'),
  P('bangkok', 'กรุงเทพมหานคร', 'Bangkok', ['กรุงเทพ', 'กทม']),
  P('phuket', 'ภูเก็ต', 'Phuket'),
  P('loei', 'เลย', 'Loei'),
];
const covered = new Set(['udon-thani', 'nong-khai', 'bangkok']);
const deps = { provinces, coveredProvinceIds: covered };

const knee: CatalogItem = { id: 'p1', title: 'โปรแกรมตรวจเข่า' };
const health: CatalogItem = { id: 'p2', title: 'โปรแกรมตรวจสุขภาพ' };
const emptyCtx: DecideContext = { recentCatalog: [], catalogOffset: 0, catalogQuery: null, selectedProgramId: null, journeyProvinceId: null };
const listCtx: DecideContext = {
  recentCatalog: [knee, health], catalogOffset: 2, catalogQuery: { provinceId: 'udon-thani', query: null },
  selectedProgramId: null, journeyProvinceId: 'udon-thani',
};

type UInput = Omit<Partial<Understanding>, 'entities'> & { entities?: Partial<Understanding['entities']> };
const U = (over: UInput): Understanding => ({
  intent: 'UNKNOWN', confidence: 0.95, uses_context: false, language: 'th', ...over,
  entities: { province: null, program_query: null, selection_index: null, detail_field: null, ...over.entities },
});

describe('provinces', () => {
  it('normalizes prefixes / ฯ / มหานคร', () => {
    expect(normalizeProvinceText('จังหวัด อุดรธานี')).toBe('อุดรธานี');
    expect(normalizeProvinceText('กรุงเทพฯ')).toBe(normalizeProvinceText('กรุงเทพมหานคร'));
  });
  it('matches aliases and English, rejects unknown', () => {
    expect(matchProvince('อุดร', provinces)?.id).toBe('udon-thani');
    expect(matchProvince('Udon Thani', provinces)?.id).toBe('udon-thani');
    expect(matchProvince('กรุงเทพฯ', provinces)?.id).toBe('bangkok');
    expect(matchProvince('ดาวอังคาร', provinces)).toBeNull();
  });
  it('short names need an explicit marker (no false hit on "เลย")', () => {
    expect(detectProvinceInText('ไม่มีเลยค่ะ', provinces)).toBeNull();
    expect(detectProvinceInText('อยากไปจังหวัดเลย', provinces)?.id).toBe('loei');
    expect(detectProvinceInText('สนใจโปรแกรมอุดร', provinces)?.id).toBe('udon-thani');
  });
  it('maps catalog free-text provinces to ids', () => {
    expect([...coveredProvinceIds(['อุดรธานี', 'กรุงเทพฯ', 'ที่ไม่มี'], provinces)].sort()).toEqual(['bangkok', 'udon-thani']);
  });
});

describe('validation', () => {
  it('rejects bad intent / confidence, clamps and nulls junk', () => {
    expect(parseUnderstanding({ intent: 'NOPE', confidence: 0.9 })).toBeNull();
    expect(parseUnderstanding({ intent: 'UNKNOWN', confidence: 'high' })).toBeNull();
    const u = parseUnderstanding({ intent: 'PROGRAM_SEARCH', confidence: 7, entities: { province: 'null', selection_index: -1, detail_field: 'x' } })!;
    expect(u.confidence).toBe(1);
    expect(u.entities).toEqual({ province: null, program_query: null, selection_index: null, detail_field: null });
  });
  it('extracts JSON from fenced replies', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('no json')).toBeNull();
  });
});

describe('decide: catalog family', () => {
  it('discovery with province -> SEARCH', () => {
    const a = decide(U({ intent: 'PROGRAM_DISCOVERY', entities: { province: 'อุดร' } }), 'สนใจโปรแกรมอุดร', emptyCtx, deps);
    expect(a).toMatchObject({ type: 'SEARCH', kind: 'discovery', offset: 0 });
    expect((a as { province: ProvinceRecord }).province.id).toBe('udon-thani');
  });
  it('discovery without province -> ASK_PROVINCE (never inherits)', () => {
    expect(decide(U({ intent: 'PROGRAM_DISCOVERY' }), 'สนใจโปรแกรม', { ...emptyCtx, journeyProvinceId: 'udon-thani' }, deps).type).toBe('ASK_PROVINCE');
  });
  it('province missing from model output is recovered from the text', () => {
    expect(decide(U({ intent: 'PROGRAM_DISCOVERY' }), 'อุดรมีอะไรบ้าง', emptyCtx, deps)).toMatchObject({ type: 'SEARCH' });
  });
  it('known province without catalog -> NO_COVERAGE (no hallucination)', () => {
    expect(decide(U({ intent: 'PROGRAM_DISCOVERY', entities: { province: 'ภูเก็ต' } }), 'สนใจโปรแกรมภูเก็ต', emptyCtx, deps).type).toBe('NO_COVERAGE');
  });
  it('unknown province string is never sent to search', () => {
    expect(decide(U({ intent: 'PROGRAM_DISCOVERY', entities: { province: 'ดาวอังคาร' } }), 'โปรแกรมดาวอังคาร', emptyCtx, deps).type).toBe('ASK_PROVINCE');
  });
  it('specific search without province searches catalog-wide', () => {
    expect(decide(U({ intent: 'PROGRAM_SEARCH', entities: { program_query: 'ตรวจเข่า' } }), 'มีตรวจเข่าไหม', emptyCtx, deps)).toMatchObject({ type: 'SEARCH', province: null, query: 'ตรวจเข่า' });
  });
  it('search inherits journey province only when the sentence uses context', () => {
    const q = { intent: 'PROGRAM_SEARCH' as const, entities: { program_query: 'ตรวจเข่า' } };
    expect(decide(U({ ...q, uses_context: true }), 'แล้วตรวจเข่าล่ะ', listCtx, deps)).toMatchObject({ province: { id: 'udon-thani' } });
    expect(decide(U({ ...q, uses_context: false }), 'มีตรวจเข่าไหม', listCtx, deps)).toMatchObject({ province: null });
  });
  it('selection resolves against the shown list', () => {
    expect(decide(U({ intent: 'PROGRAM_SELECTION', uses_context: true, entities: { selection_index: 0 } }), 'เอาอันแรก', listCtx, deps)).toMatchObject({ type: 'SELECT', index: 0, item: knee });
    expect(decide(U({ intent: 'PROGRAM_SELECTION', entities: { selection_index: 2 } }), 'เอาอันที่สาม', listCtx, deps).type).toBe('ASK_SELECTION');
  });
  it('selection / more without a trusted list defer to legacy', () => {
    expect(decide(U({ intent: 'PROGRAM_SELECTION', entities: { selection_index: 0 } }), 'เอาอันแรก', emptyCtx, deps)).toEqual({ type: 'DEFER', reason: 'no_catalog_context' });
    expect(decide(U({ intent: 'PROGRAM_MORE' }), 'มีอีกไหม', emptyCtx, deps)).toEqual({ type: 'DEFER', reason: 'no_catalog_context' });
  });
  it('"more" continues the same list from the stored offset', () => {
    expect(decide(U({ intent: 'PROGRAM_MORE', uses_context: true }), 'มีอีกไหม', listCtx, deps)).toMatchObject({ type: 'SEARCH', kind: 'more', offset: 2, province: { id: 'udon-thani' } });
  });
  it('price follow-up: needs a resolvable item', () => {
    expect(decide(U({ intent: 'PROGRAM_DETAIL', entities: { detail_field: 'price' } }), 'ตัวนี้ราคาเท่าไหร่', listCtx, deps).type).toBe('ASK_SELECTION');
    expect(decide(U({ intent: 'PROGRAM_DETAIL', entities: { detail_field: 'price' } }), 'ตัวนี้ราคาเท่าไหร่', { ...listCtx, selectedProgramId: 'p2' }, deps)).toMatchObject({ type: 'DETAIL', item: health });
    expect(decide(U({ intent: 'PROGRAM_DETAIL', entities: { detail_field: 'price' } }), 'ราคา', { ...listCtx, recentCatalog: [knee] }, deps)).toMatchObject({ type: 'DETAIL', item: knee });
  });
  it('booking details stay on the legacy concierge flow', () => {
    expect(decide(U({ intent: 'PROGRAM_DETAIL', entities: { detail_field: 'booking' } }), 'จองยังไง', { ...listCtx, selectedProgramId: 'p1' }, deps)).toEqual({ type: 'DEFER', reason: 'detail_booking' });
  });
});

describe('decide: confidence gate and non-catalog intents', () => {
  it('low confidence never guesses', () => {
    expect(decide(U({ intent: 'PROGRAM_DISCOVERY', confidence: 0.3, entities: { province: 'อุดร' } }), 'x', emptyCtx, deps)).toEqual({ type: 'DEFER', reason: 'low_confidence' });
  });
  it('medium confidence asks to confirm an item picked without context', () => {
    expect(decide(U({ intent: 'PROGRAM_SELECTION', confidence: 0.6, entities: { selection_index: 0 } }), '1', listCtx, deps)).toMatchObject({ type: 'ASK_CLARIFY', item: knee });
  });
  it('hotel / transport / handoff / smalltalk / general defer; reset clears state', () => {
    for (const intent of ['HOTEL', 'TRANSPORT', 'HANDOFF', 'SMALLTALK', 'GENERAL_QUESTION', 'UNKNOWN'] as const) {
      expect(decide(U({ intent }), 'x', listCtx, deps).type).toBe('DEFER');
    }
    expect(decide(U({ intent: 'RESET' }), 'เริ่มใหม่', listCtx, deps).type).toBe('RESET');
  });
});

describe('catalog trust', () => {
  const hist = (t: string) => [{ role: 'assistant', content: t }];
  it('trusts the stored list only if the last assistant message shows it', () => {
    expect(catalogMatchesHistory([knee, health], hist('1. โปรแกรมตรวจเข่า\n2. โปรแกรมตรวจสุขภาพ'))).toBe(true);
    expect(catalogMatchesHistory([knee, health], hist('ที่พักมีห้อง...'))).toBe(false);
    expect(catalogMatchesHistory([], hist('x'))).toBe(false);
  });
});
