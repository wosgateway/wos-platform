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

function rpcRow(id: string, title: string) {
  return { id, title, special_price: 1500, status: 'published', is_active: true,
    partner_id_out: 'clinic', partner_name: 'Clinic', partner_category: 'clinic',
    partner_status: 'active', partner_province: 'อุดรธานี' };
}
const knee = rpcRow('knee', 'ตรวจเข่า');
const health = rpcRow('health', 'ตรวจสุขภาพ');
const fixtures: Record<string, ReturnType<typeof rpcRow>[]> = {
  'ตรวจเข่า': [knee],
  'ตรวจสุขภาพ': [health],
};

function chat() {
  const history: WosAIHistoryMessage[] = [];
  return { history, async say(message: string) {
    const state = deriveWosJourneyState(history, message);
    const reply = await runWosAI(message, history);
    history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
    return { state, reply };
  } };
}
function searchTerms() {
  return db.rpc.mock.calls.map(([, args]) => args.search_term);
}

beforeEach(() => {
  vi.restoreAllMocks();
  db.rpc.mockReset().mockImplementation(async (name: string, args: { search_term: string }) => {
    expect(name).toBe('search_packages_thai');
    return { data: fixtures[args.search_term] ?? [], error: null };
  });
  db.browse.mockReset().mockResolvedValue({ data: [knee, health].map(row => ({
    ...row, partners: { id: 'clinic', name: 'Clinic', category: 'clinic', status: 'active', province: 'อุดรธานี' },
  })), error: null });
});

describe('explicit selection through real candidate generation and relevance filtering', () => {
  it('distinguishes the conversational wrapper from the exact knee title', async () => {
    expect(await programs.searchPrograms('เลือกตรวจเข่า', 3)).toEqual([]);
    expect(searchTerms()).toEqual(['เลือกตรวจเข่า']);
    db.rpc.mockClear();
    expect(await programs.searchPrograms('ตรวจเข่า', 3)).toMatchObject([{ id: 'knee', title: 'ตรวจเข่า' }]);
    expect(searchTerms()).toEqual(['ตรวจเข่า']);
  });

  it('rejects a fuzzy RPC row that fails the real relevance filter', async () => {
    db.rpc.mockResolvedValue({ data: [health], error: null });
    expect(await programs.searchPrograms('ตรวจเข่า', 3)).toEqual([]);
    expect(searchTerms()).toEqual(['ตรวจเข่า']);
  });

  it.each(['เลือก', 'เอา', 'ต้องการ', 'choose '])('%s uses the extracted knee title and waits for a real name', async verb => {
    const search = vi.spyOn(programs, 'searchPrograms'); // call-through, never a result mock
    const c = chat();
    const selected = await c.say(`${verb}ตรวจเข่า`);
    expect(search.mock.calls).toEqual([['ตรวจเข่า', 3]]);
    expect(searchTerms()).toEqual(['ตรวจเข่า']);
    expect(selected.state.selectedProgram).toBe('ตรวจเข่า');
    expect(selected.state.customerName).toBeUndefined();
    expect(classifyAssistantQuestion(selected.reply)).toBe('name');
    const named = await c.say('สมชาย');
    expect(named.state).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย' });
    expect(classifyAssistantQuestion(named.reply)).toBe('transport');
  });

  it('confirms a Lao explicit selection through the same canonical catalog title', async () => {
    const search = vi.spyOn(programs, 'searchPrograms');
    const selected = await chat().say('ເລືອກກວດເຂົ່າ');
    expect(search.mock.calls).toEqual([['ตรวจเข่า', 3]]);
    expect(searchTerms()).toEqual(['ตรวจเข่า']);
    expect(selected.state.selectedProgram).toBe('ตรวจเข่า');
    expect(selected.state.customerName).toBeUndefined();
    expect(classifyAssistantQuestion(selected.reply)).toBe('name');
  });

  it('uses the extracted health title without relying on the wrapper alias', async () => {
    const search = vi.spyOn(programs, 'searchPrograms');
    const selected = await chat().say('เลือกตรวจสุขภาพ');
    expect(search.mock.calls).toEqual([['ตรวจสุขภาพ', 3]]);
    expect(searchTerms()).toEqual(['ตรวจสุขภาพ']);
    expect(selected.state.customerName).toBeUndefined();
    expect(classifyAssistantQuestion(selected.reply)).toBe('name');
  });

  it('keeps a nonexistent explicit selection unresolved', async () => {
    const c = chat();
    const selected = await c.say('เลือกโปรแกรมที่ไม่มีจริง');
    expect(searchTerms()).not.toContain('เลือกโปรแกรมที่ไม่มีจริง');
    expect(selected.reply).toContain('ยังไม่มีข้อมูลที่ยืนยัน');
    expect(classifyAssistantQuestion(selected.reply)).not.toBe('name');
    expect(deriveWosJourneyState(c.history, 'สมชาย').selectedProgram).toBeUndefined();
  });

  it('does not confirm a near-match title returned by the real search path', async () => {
    db.rpc.mockResolvedValue({ data: [rpcRow('near', 'ตรวจเข่าเพิ่มเติม')], error: null });
    const selected = await chat().say('เลือกตรวจเข่า');
    expect(searchTerms()).toEqual(['ตรวจเข่า']);
    expect(selected.reply).toContain('ยังไม่มีข้อมูลที่ยืนยัน');
    expect(classifyAssistantQuestion(selected.reply)).not.toBe('name');
    expect(selected.state.customerName).toBeUndefined();
  });

  it('replaces a program after thanks and preserves the new selection on the name turn', async () => {
    const c = chat();
    await c.say('เลือกตรวจสุขภาพ');
    await c.say('ขอบคุณ');
    const search = vi.spyOn(programs, 'searchPrograms');
    db.rpc.mockClear();
    const replaced = await c.say('เลือกตรวจเข่า');
    expect(search.mock.calls).toEqual([['ตรวจเข่า', 3]]);
    expect(searchTerms()).toEqual(['ตรวจเข่า']);
    expect(replaced.state.selectedProgram).toBe('ตรวจเข่า');
    expect(replaced.state.customerName).toBeUndefined();
    expect(classifyAssistantQuestion(replaced.reply)).toBe('name');
    const named = await c.say('สมชาย');
    expect(named.state).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย' });
    expect(classifyAssistantQuestion(named.reply)).toBe('transport');
  });

  it('keeps discovery and province/catalog continuation outside the old journey', async () => {
    const c = chat();
    await c.say('เลือกตรวจเข่า');
    const discovered = await c.say('มีโปรแกรมอะไรบ้าง');
    expect(discovered.state.selectedProgram).toBeUndefined();
    expect(discovered.state.customerName).toBeUndefined();
    expect(discovered.reply).toContain('จังหวัด');
    expect(classifyAssistantQuestion(discovered.reply)).not.toBe('name');
    const province = await c.say('อุดรธานี');
    expect(province.state.selectedProgram).toBeUndefined();
    expect(province.state.customerName).toBeUndefined();
    expect(classifyAssistantQuestion(province.reply)).not.toBe('name');
  });

  it('keeps reset/new-program boundaries and clears the old name', async () => {
    const c = chat();
    await c.say('เลือกตรวจเข่า');
    await c.say('สมชาย');
    await c.say('เริ่มใหม่');
    const selected = await c.say('เลือกตรวจสุขภาพ');
    expect(selected.state.selectedProgram).toBe('ตรวจสุขภาพ');
    expect(selected.state.customerName).toBeUndefined();
    expect(selected.state.activePendingQuestion).toBeUndefined();
    expect(classifyAssistantQuestion(selected.reply)).toBe('name');
  });

});