import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWosAI, type WosAIHistoryMessage } from './core';
import * as programs from './programs';
import { classifyAssistantQuestion, deriveWosJourneyState, isNewJourneyServiceTopic } from './journey-state';

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

describe('consistent explicit selection and semantic name boundaries', () => {
  for (const title of ['ตรวจเข่า', 'ตรวจสุขภาพ']) {
    it.each(['interested in ', 'choose ', 'เลือก', 'เอา', 'ต้องการ'])('%s' + title + ' recognizes selection without fabricating a name', async verb => {
      const search = vi.spyOn(programs, 'searchPrograms');
      const c = chat();
      const selected = await c.say(`${verb}${title}`);
      expect(selected.state.selectedProgram).toBe(title);
      expect(selected.state.customerName).toBeUndefined();
      expect(search).toHaveBeenCalledWith(title, 3);
      expect(classifyAssistantQuestion(selected.reply)).toBe('name');
    });
  }

  it('English explicit replacement wins over a pending name and survives the real name answer', async () => {
    const c = chat();
    expect(classifyAssistantQuestion((await c.say('เลือกตรวจเข่า')).reply)).toBe('name');
    const replaced = await c.say('interested in ตรวจสุขภาพ');
    expect(replaced.state.selectedProgram).toBe('ตรวจสุขภาพ');
    expect(replaced.state.customerName).toBeUndefined();
    expect(classifyAssistantQuestion(replaced.reply)).toBe('name');
    expect((await c.say('John')).state).toMatchObject({ selectedProgram: 'ตรวจสุขภาพ', customerName: 'John' });
  });

  it.each(['สปาร์ค', 'หมอก', 'Spaulding', 'Booker'])('accepts the actual name answer %s without treating a substring as a service', async name => {
    const c = chat();
    expect(classifyAssistantQuestion((await c.say('เลือกตรวจเข่า')).reply)).toBe('name');
    const named = await c.say(name);
    expect(named.state.customerName).toBe(name);
    expect(named.state.selectedProgram).toBe('ตรวจเข่า');
    expect(isNewJourneyServiceTopic(name)).toBe(false);
    expect(classifyAssistantQuestion(named.reply)).toBe('transport');
    const interrupted = await c.say('ขอบคุณ');
    expect(interrupted.state).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: name });
  });

  it.each(['สปา', 'อยากไปสปา', 'นวดสปา', 'อยากนวดสปา', 'spa', 'massage'])('still rejects the actual service/topic %s at the name gate', async message => {
    const c = chat();
    expect(classifyAssistantQuestion((await c.say('เลือกตรวจเข่า')).reply)).toBe('name');
    const service = await c.say(message);
    expect(service.state.customerName).toBeUndefined();
    expect(service.state.selectedProgram).toBeUndefined();
    expect(isNewJourneyServiceTopic(message)).toBe(true);
  });

  it.each(['เลือกสปา', 'interested in สปา', 'เลือกตรวจสุขภาพ', 'interested in ตรวจสุขภาพ'])('does not turn the explicit selection %s into a customer name', async message => {
    const c = chat();
    await c.say('เลือกตรวจเข่า');
    const selected = await c.say(message);
    expect(selected.state.customerName).toBeUndefined();
    expect(selected.state.selectedProgram).toBe(message.endsWith('ตรวจสุขภาพ') ? 'ตรวจสุขภาพ' : 'สปา');
  });
});