import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { classifyAssistantQuestion, deriveWosJourneyState, type WosJourneyState } from '@/lib/ai/journey-state';
import type { WosAIHistoryMessage } from '@/lib/ai/core';

type Row = Record<string, unknown>;
type DbResult = { data: unknown; error: null | { code?: string; message: string } };
type Query = PromiseLike<DbResult> & {
  select(): Query; eq(key: string, value: unknown): Query; order(): Query; limit(): Query;
  insert(row: Row): Query; update(row: Row): Query; upsert(row: Row): Query; delete(): Query;
  single(): Promise<DbResult>; maybeSingle(): Promise<DbResult>;
};
const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), fetch: vi.fn(), model: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: io.from, rpc: io.rpc }) }));
vi.mock('@/lib/supabase/server', () => ({ createAnonClient: () => ({ from: io.from, rpc: io.rpc }) }));
vi.mock('@/lib/ai/notion-knowledge', () => ({ searchWosNotionKnowledge: async () => [] }));
vi.mock('openai', () => ({ default: class { constructor() { io.model(); throw new Error('Unexpected model I/O'); } } }));

let POST: typeof import('./route')['POST'];
let history: WosAIHistoryMessage[];
let replies: string[];
let events: Map<number, Row>;
let leads: Map<string, Row>;
let persisted: Row | null;
let unexpected: string[];
let messageId: number;
let sender: { name: string; phone_number?: string };

const provinces = [
  { id: 'udon', name_th: 'อุดรธานี', name_en: 'Udon Thani', name_lo: 'ອຸດອນທານີ', aliases: ['อุดร'] },
  { id: 'nongkhai', name_th: 'หนองคาย', name_en: 'Nong Khai', name_lo: 'ໜອງຄາຍ', aliases: [] },
];
const knee = { id: 'knee', title: 'ตรวจเข่า', special_price: 1500, status: 'published', is_active: true,
  partner_id_out: 'clinic', partner_name: 'Fixture Clinic', partner_category: 'clinic', partner_status: 'active',
  partner_province: 'อุดรธานี', partners: { id: 'clinic', name: 'Fixture Clinic', category: 'clinic', status: 'active', province: 'อุดรธานี' } };

function query(table: string): Query {
  let operation = 'read'; let values: Row = {}; const filters: Row = {};
  const result = (): DbResult => {
    if (table === 'provinces') return { data: provinces, error: null };
    if (table === 'packages') return { data: [knee], error: null };
    if (table === 'ai_conversation_state') {
      if (operation === 'delete') persisted = null;
      if (operation === 'upsert' || operation === 'update') persisted = { ...persisted, ...values };
      return { data: operation === 'read' ? persisted : null, error: null };
    }
    if (table === 'chatwoot_webhook_events') {
      if (operation === 'insert') {
        const id = Number(values.chatwoot_message_id);
        if (events.has(id)) return { data: null, error: { code: '23505', message: 'fixture duplicate' } };
        events.set(id, { ...values, id: String(id) });
        return { data: { id: String(id) }, error: null };
      }
      const id = Number(filters.id);
      if (operation === 'update') events.set(id, { ...events.get(id), ...values });
      if (operation === 'delete') events.delete(id);
      return { data: null, error: null };
    }
    if (table === 'notification_outbox') return { data: { status: 'sent' }, error: null };
    unexpected.push('table:' + table); throw new Error('Unexpected database adapter access: ' + table);
  };
  const q: Query = {
    select: () => q, eq: (key, value) => { filters[key] = value; return q; }, order: () => q, limit: () => q,
    insert: row => { operation = 'insert'; values = row; return q; },
    update: row => { operation = 'update'; values = row; return q; },
    upsert: row => { operation = 'upsert'; values = row; return q; },
    delete: () => { operation = 'delete'; return q; },
    single: async () => result(), maybeSingle: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return q;
}

beforeAll(async () => {
  vi.stubEnv('CHATWOOT_BASE_URL', 'https://chatwoot.fixture.invalid');
  vi.stubEnv('CHATWOOT_ACCOUNT_ID', '1');
  vi.stubEnv('CHATWOOT_API_ACCESS_TOKEN', 'fixture-only');
  vi.stubEnv('CHATWOOT_WEBHOOK_SECRET', 'fixture-only');
  vi.stubEnv('WOS_AI_UNDERSTANDING', 'off');
  vi.stubEnv('VERCEL', '0');
  ({ POST } = await import('./route'));
});
beforeEach(() => {
  vi.clearAllMocks(); history = []; replies = []; events = new Map(); leads = new Map(); persisted = null; unexpected = []; messageId = 1000;
  sender = { name: 'Wos Admin', phone_number: '+8562055512345' };
  io.from.mockImplementation(query);
  io.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'search_packages_thai') return { data: String(args.search_term).includes('ตรวจเข่า') ? [knee] : [], error: null };
    if (name === 'submit_ai_handoff') {
      const key = String(args.p_idempotency_key); const created = !leads.has(key);
      if (created) leads.set(key, args);
      return { data: { id: 'lead-fixture', created }, error: null };
    }
    if (name === 'claim_outbox_batch') return { data: [], error: null };
    unexpected.push('rpc:' + name); throw new Error('Unexpected RPC: ' + name);
  });
  io.fetch.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://chatwoot.fixture.invalid') { unexpected.push('fetch:' + url.origin); throw new Error('External fetch forbidden'); }
    if (url.pathname.endsWith('/messages') && !init?.method) {
      return Response.json({ payload: history.map((m, i) => ({ id: i + 1, content: m.content, message_type: m.role === 'user' ? 0 : 1, private: false, created_at: i })) });
    }
    if (url.pathname.endsWith('/messages') && init?.method === 'POST') { replies.push(JSON.parse(String(init.body)).content); return Response.json({}); }
    if (url.pathname === '/api/v1/accounts/1/conversations/99' && init?.method === 'PATCH') { expect(JSON.parse(String(init.body))).toEqual({ status: 'open' }); return Response.json({}); }
    unexpected.push('http:' + url.pathname); throw new Error('Unexpected fixture HTTP path');
  });
  vi.stubGlobal('fetch', io.fetch);
});
afterEach(() => { expect(unexpected).toEqual([]); expect(io.model).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
afterAll(() => vi.unstubAllEnvs());

async function say(content: string) {
  const state = deriveWosJourneyState(history, content);
  const before = replies.length;
  const req = new NextRequest('https://webhook.fixture.invalid/api/chatwoot/webhook?secret=fixture-only', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: ++messageId, event: 'message_created', message_type: 'incoming', private: false,
      content, sender, conversation: { id: 99, status: 'pending', meta: { assignee: { id: 1, type: 'agent_bot' } } } }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200); expect(await res.json()).toEqual({ status: 'ok' });
  expect(replies.length).toBe(before + 1);
  const reply = replies.at(-1)!;
  history.push({ role: 'user', content }, { role: 'assistant', content: reply });
  expect(events.get(messageId)?.status).toBe('sent');
  expect(reply).not.toMatch(/จุดส่ง|ไปส่งที่ไหน|drop.?off|destination|ຈຸດສົ່ງ/iu);
  return { state, reply };
}
async function selectAndName(name = 'สมชาย', selection = 'เลือกตรวจเข่า') {
  expect(classifyAssistantQuestion((await say(selection)).reply)).toBe('name');
  const named = await say(name);
  expect(named.state).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: name });
  expect(classifyAssistantQuestion(named.reply)).toBe('transport');
}
function onlyLead() { expect(leads.size).toBe(1); return [...leads.values()][0]; }

describe('canonical webhook Concierge v1: real POST/core/state/handoff, adapter fixtures only', () => {
  // Prevents typed customer identity being replaced by a Chatwoot profile at the handoff boundary.
  it.each(['สมชาย', 'ສົມຊາຍ', 'John Smith'])('retains %s through name/transport/hotel and real submitHandoff', async name => {
    await selectAndName(name);
    sender.name = 'Profile Name';
    expect(classifyAssistantQuestion((await say('ไม่ต้องการรถรับส่ง')).reply)).toBe('hotel');
    await say('ไม่ต้องการโรงแรม');
    const lead = onlyLead();
    expect(lead.p_name).toBe(name);
    expect(lead.p_journey_snapshot).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: name, transportNeeded: false, hotelNeeded: false });
    expect(String(lead.p_message)).toContain('ตรวจเข่า');
  });
  // A generic contact profile must not force re-collection of an already supplied name.
  it('hands off a typed name with phone metadata even when profile name is generic', async () => {
    sender.name = 'Wos Admin';
    await selectAndName(); await say('ไม่ต้องการรถรับส่ง'); await say('ไม่ต้องการโรงแรม');
    expect(onlyLead().p_name).toBe('สมชาย');
  });
  // Pickup is open-ended across Laos, and owns the slot instead of resetting catalog province.
  it.each(['เวียงจันทน์', 'ปากเซ', 'หลวงพระบาง', 'แขวงคำม่วน', 'ສະຫວັນນະເຂດ', 'Savannakhet'])('captures %s as pickup and submits it without dropoff', async pickup => {
    await selectAndName(); expect(classifyAssistantQuestion((await say('ต้องการรถรับส่ง')).reply)).toBe('pickup');
    const picked = await say(pickup);
    expect(picked.state).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย', transportNeeded: true, transportOrigin: pickup, answeredQuestion: 'pickup' });
    expect(classifyAssistantQuestion(picked.reply)).toBe('hotel');
    await say('สนใจ');
    const snapshot = onlyLead().p_journey_snapshot as WosJourneyState;
    expect(snapshot).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย', transportNeeded: true, transportOrigin: pickup, hotelNeeded: true });
    expect(snapshot.transportDestination).toBeUndefined();
    expect(String(onlyLead().p_message)).toContain(pickup);
  });
  // Natural Lao answers must bind to the same pending questions as Thai.
  it('preserves the Lao name, affirmative pickup flow and negative hotel decision', async () => {
    await selectAndName('ສົມຊາຍ', 'ເລືອກກວດເຂົ່າ');
    expect(classifyAssistantQuestion((await say('ຕ້ອງການ')).reply)).toBe('pickup');
    await say('ຫຼວງພະບາງ'); await say('ບໍ່ຕ້ອງການ');
    expect(onlyLead().p_journey_snapshot).toMatchObject({ customerName: 'ສົມຊາຍ', transportOrigin: 'ຫຼວງພະບາງ', hotelNeeded: false });
  });
  // Unknown location answers must leave pickup pending rather than invent a point.
  it.each(['ยังไม่แน่ใจ', 'ບໍ່ແນ່ໃຈ'])('does not treat %s as an actual pickup point', async message => {
    await selectAndName(); await say('ต้องการรถรับส่ง');
    const answer = await say(message);
    expect(answer.state.transportOrigin).toBeUndefined();
    expect(classifyAssistantQuestion(answer.reply)).toBe('pickup'); expect(leads.size).toBe(0);
  });
  // A hotel information question is not consent and must not call submitHandoff.
  it.each(['มีโรงแรมแบบไหนบ้าง', 'ໂຮງແຮມມີແບບໃດແດ່'])('keeps hotel information %s separate from the eventual negative hotel answer', async question => {
    await selectAndName(); await say('ไม่ต้องการรถรับส่ง');
    const information = await say(question);
    expect(information.state.hotelNeeded).toBeUndefined(); expect(leads.size).toBe(0);
    const declined = await say('ไม่ต้องการโรงแรม');
    expect(declined.state.hotelNeeded).toBe(false); expect(onlyLead().p_journey_snapshot).toMatchObject({ hotelNeeded: false });
    expect(classifyAssistantQuestion(declined.reply)).not.toBe('hotel');
  });
  // Reset must clear persisted province/catalog and conversation-history slots through real clearState.
  it.each(['เริ่มใหม่', 'start new'])('%s prevents old name/program/pickup/province leaking', async reset => {
    sender.name = 'Wos Admin'; await selectAndName(); await say('ต้องการรถรับส่ง'); await say('ปากเซ');
    persisted = { province_id: 'nongkhai', selected_program_id: 'stale', catalog_query: { provinceId: 'nongkhai', query: 'old' } };
    await say(reset); expect(persisted).toBeNull();
    const state = deriveWosJourneyState(history, 'สนใจโปรแกรม');
    expect(state.selectedProgram).toBeUndefined(); expect(state.customerName).toBeUndefined(); expect(state.transportOrigin).toBeUndefined();
    const discovery = await say('สนใจโปรแกรม');
    expect(discovery.reply).toMatch(/จังหวัด/); expect(leads.size).toBe(0);
  });
});

describe('Concierge v1 handoff summaries and retention boundaries', () => {
  // Both the customer and the WOS team need the five V1 slots, not just an acknowledgement.
  it('includes name/program/transport/pickup/hotel in the customer and team handoff summaries', async () => {
    await selectAndName(); await say('ต้องการรถรับส่ง'); await say('ปากเซ');
    const final = await say('สนใจ');
    const lead = onlyLead(); const teamText = (lead.p_notify_payload as { text: string }).text;
    for (const text of [final.reply, teamText]) {
      expect(text).toContain('สมชาย'); expect(text).toContain('ตรวจเข่า');
      expect(text).toContain('รถรับส่ง: ต้องการ'); expect(text).toContain('จุดรับ: ปากเซ'); expect(text).toContain('โรงแรม: ต้องการ');
    }
  });
  // Negative optional-service decisions must be explicit in the handoff, with no invented pickup.
  it('summarizes declined services and does not invent a pickup', async () => {
    await selectAndName(); await say('ไม่ต้องการรถรับส่ง'); const final = await say('ไม่ต้องการโรงแรม');
    const lead = onlyLead(); const teamText = (lead.p_notify_payload as { text: string }).text;
    for (const text of [final.reply, teamText]) {
      expect(text).toContain('รถรับส่ง: ไม่ต้องการ'); expect(text).toContain('โรงแรม: ไม่ต้องการ'); expect(text).not.toMatch(/จุดรับ:/u);
    }
  });
  // Repeating yes while pickup is pending must not fill pickup or accidentally accept a hotel.
  it.each(['ต้องการ', 'ຕ້ອງການ'])('a repeated affirmative %s stays owned by the pickup question', async answer => {
    await selectAndName(); await say('ต้องการรถรับส่ง'); const repeated = await say(answer);
    expect(repeated.state).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย', transportNeeded: true });
    expect(repeated.state.transportOrigin).toBeUndefined(); expect(repeated.state.hotelNeeded).toBeUndefined();
    expect(classifyAssistantQuestion(repeated.reply)).toBe('pickup'); expect(leads.size).toBe(0);
  });
  // A repeated decline after handoff must not reopen the hotel question or create another lead.
  it('retains declined hotel and accepted identity across a repeated decline', async () => {
    await selectAndName(); await say('ไม่ต้องการรถรับส่ง'); await say('ไม่ต้องการโรงแรม');
    const repeated = await say('ไม่ต้องการโรงแรม');
    expect(repeated.state).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย', transportNeeded: false, hotelNeeded: false });
    expect(classifyAssistantQuestion(repeated.reply)).not.toBe('hotel'); expect(leads.size).toBe(1);
  });
  // Catalog cache metadata cannot replace the selected program that owns an active intake.
  it('ignores a stale persisted catalog selection during an active selected-program intake', async () => {
    await selectAndName();
    persisted = { province_id: 'nongkhai', selected_program_id: 'stale-health', last_catalog: [{ id: 'stale-health', title: 'ตรวจสุขภาพ' }], catalog_query: { provinceId: 'nongkhai', query: 'ตรวจสุขภาพ' }, catalog_updated_at: new Date().toISOString() };
    const searchesBefore = io.rpc.mock.calls.filter(([name]) => name === 'search_packages_thai').length;
    await say('ไม่ต้องการรถรับส่ง'); await say('ไม่ต้องการโรงแรม');
    expect(onlyLead().p_journey_snapshot).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย' });
    expect(io.rpc.mock.calls.filter(([name]) => name === 'search_packages_thai')).toHaveLength(searchesBefore);
  });
  // Acknowledgements do not erase selected program/name or steal the pending pickup slot.
  it.each(['ขอบคุณครับ', 'ຂອບໃຈ'])('retains the current intake across %s', async acknowledgement => {
    await selectAndName(); await say('ต้องการรถรับส่ง'); await say(acknowledgement);
    const picked = await say('หลวงพระบาง');
    expect(picked.state).toMatchObject({ selectedProgram: 'ตรวจเข่า', customerName: 'สมชาย', transportNeeded: true, transportOrigin: 'หลวงพระบาง' });
    expect(classifyAssistantQuestion(picked.reply)).toBe('hotel');
  });
  // A Lao negative transport answer skips pickup and leaves hotel undecided until its own answer.
  it('binds Lao negative transport and positive hotel answers independently', async () => {
    await selectAndName('ສົມຊາຍ', 'ເລືອກກວດເຂົ່າ'); const noTransport = await say('ບໍ່ເອົາ');
    expect(noTransport.state.transportNeeded).toBe(false); expect(noTransport.state.transportOrigin).toBeUndefined(); expect(noTransport.state.hotelNeeded).toBeUndefined();
    expect(classifyAssistantQuestion(noTransport.reply)).toBe('hotel'); await say('ສົນໃຈ');
    expect(onlyLead().p_journey_snapshot).toMatchObject({ customerName: 'ສົມຊາຍ', transportNeeded: false, hotelNeeded: true });
  });
});
describe('Concierge v1 incomplete-contact and handoff-failure boundary', () => {
  // Already accepted names stay authoritative when the missing field is the contact channel.
  it.each([
    { name: 'สมชาย', answer: 'ไม่ต้องการโรงแรม', contactPattern: /เบอร์โทร|อีเมล/iu },
    { name: 'ສົມຊາຍ', answer: 'ບໍ່ຕ້ອງການໂຮງແຮມ', contactPattern: /ເບີໂທ|email/iu },
    { name: 'John Smith', answer: 'no hotel please', contactPattern: /phone number|email/iu },
  ])('asks only for missing contact information for $name', async ({ name, answer, contactPattern }) => {
    sender = { name: 'Wos Admin' }; await selectAndName(name); await say('ไม่ต้องการรถรับส่ง');
    const final = await say(answer);
    expect(final.reply).toMatch(contactPattern);
    expect(final.reply).not.toMatch(/ขอชื่อ|provide your name|ຂໍຊື່/iu); expect(leads.size).toBe(0);
    expect(final.state.customerName).toBe(name);
  });
  // A failed durable handoff cannot produce the successful request-saved acknowledgement.
  it('reports a real submitHandoff database-adapter failure without claiming successful handoff', async () => {
    await selectAndName(); await say('ไม่ต้องการรถรับส่ง');
    io.rpc.mockResolvedValueOnce({ data: null, error: { message: 'fixture handoff failure' } });
    const final = await say('ไม่ต้องการโรงแรม');
    expect(final.reply).toMatch(/ยังส่งคำขอ.*ไม่สำเร็จ/u);
    expect(final.reply).not.toMatch(/ข้อมูลถูกบันทึก|ส่งคำขอให้ทีม WOS แล้ว/u); expect(leads.size).toBe(0);
  });
});