import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runWosAI, type WosAIHistoryMessage } from './core';
import { classifyAssistantQuestion, deriveWosJourneyState } from './journey-state';

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('./programs', async (importOriginal) => ({
  ...await importOriginal<typeof import('./programs')>(),
  searchPrograms: mocks.search,
  searchHealthProgramOverview: async () => [],
  getCatalogProvinces: async () => ['อุดรธานี', 'หนองคาย'],
  getProgramDetails: async () => null,
  detectLocationFromRawText: (text: string) => /อุดร/u.test(text) ? ['อุดรธานี'] : [],
}));
vi.mock('./understanding/gate', () => ({ runUnderstandingGate: async () => ({handled:false}) }));
vi.mock('./notion-knowledge', () => ({ searchWosNotionKnowledge: async () => [] }));
vi.mock('./hotel-availability', () => ({ searchHotelAvailability: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => { throw new Error('Unexpected database access'); } }));
vi.mock('openai', () => ({ default: class { constructor() { throw new Error('Unexpected LLM fallback'); } } }));

const catalog = [
  {id:'knee', title:'ตรวจเข่า', special_price:1500, partner:{name:'Clinic',province:'อุดรธานี'}},
  {id:'health', title:'ตรวจสุขภาพ', special_price:1900, partner:{name:'Clinic',province:'อุดรธานี'}},
  {id:'ankle', title:'ฟื้นฟูข้อเท้า', special_price:2100, partner:{name:'Clinic',province:'อุดรธานี'}},
];
function chat() {
  const history: WosAIHistoryMessage[] = [];
  return {
    history,
    async say(message: string) {
      const state = deriveWosJourneyState(history, message);
      const reply = await runWosAI(message, history);
      history.push({role:'user',content:message}, {role:'assistant',content:reply});
      return {state,reply};
    },
  };
}
beforeEach(() => { mocks.search.mockReset().mockImplementation(async (query: string) => catalog.filter(item => query.includes(item.title))); });

describe('core explicit program replacement using actual assistant replies', () => {
  for (const interruptions of [[], ['ขอบคุณ'], ['ขอบคุณ', 'ขอบคุณครับ', 'โอเค ขอบคุณ']]) {
    it('replacement with actual history: ' + JSON.stringify(interruptions), async () => {
      const c = chat(); await c.say('เลือกตรวจเข่า');
      for (const message of interruptions) await c.say(message);
      const replaced = await c.say('เลือกตรวจสุขภาพ');
      expect(replaced.state.selectedProgram).toBe('ตรวจสุขภาพ');
      expect(classifyAssistantQuestion(replaced.reply)).toBe('name');
      expect(replaced.reply).not.toContain('ราคาโปรโมชั่น');
      const named = await c.say('สมชาย');
      expect(named.state).toMatchObject({selectedProgram:'ตรวจสุขภาพ',customerName:'สมชาย'});
      expect(classifyAssistantQuestion(named.reply)).toBe('transport');
    });
  }
  it('works for another catalog title without a program-specific exception', async () => {
    const c = chat(); await c.say('เลือกตรวจเข่า');
    expect(classifyAssistantQuestion((await c.say('เลือกฟื้นฟูข้อเท้า')).reply)).toBe('name');
    const named = await c.say('วิชัย');
    expect(named.state).toMatchObject({selectedProgram:'ฟื้นฟูข้อเท้า',customerName:'วิชัย'});
    expect(classifyAssistantQuestion(named.reply)).toBe('transport');
  });
  it('reset followed by a new selection does not revive old slots/question', async () => {
    const c = chat(); await c.say('เลือกตรวจเข่า'); await c.say('สมชาย'); await c.say('เริ่มใหม่');
    const replaced = await c.say('เลือกตรวจสุขภาพ');
    expect(replaced.state.customerName).toBeUndefined();
    expect(replaced.state.activePendingQuestion).toBeUndefined();
    expect(classifyAssistantQuestion(replaced.reply)).toBe('name');
    expect((await c.say('วิชัย')).state).toMatchObject({selectedProgram:'ตรวจสุขภาพ',customerName:'วิชัย'});
  });
  it('discovery remains discovery after an old journey', async () => {
    const c = chat(); await c.say('เลือกตรวจเข่า');
    const discovered = await c.say('มีโปรแกรมอะไรบ้าง');
    expect(discovered.state.selectedProgram).toBeUndefined();
    expect(classifyAssistantQuestion(discovered.reply)).not.toBe('name');
    expect(discovered.reply).toContain('จังหวัด');
  });
  it('province/catalog switch cannot revive the old selection', async () => {
    const c = chat(); await c.say('เลือกตรวจเข่า'); await c.say('มีโปรแกรมอะไรบ้าง');
    const switched = await c.say('อุดร');
    expect(switched.state.selectedProgram).toBeUndefined();
    expect(classifyAssistantQuestion(switched.reply)).not.toBe('name');
  });
  it('unresolved explicit choice does not enter booking or create durable selection', async () => {
    const c = chat(); await c.say('เลือกตรวจเข่า');
    const unresolved = await c.say('เลือกโปรแกรมที่ไม่มีจริง');
    expect(classifyAssistantQuestion(unresolved.reply)).not.toBe('name');
    expect(unresolved.reply).toContain('ยังไม่มีข้อมูลที่ยืนยัน');
    expect(deriveWosJourneyState(c.history, 'วิชัย').selectedProgram).toBeUndefined();
  });
});
