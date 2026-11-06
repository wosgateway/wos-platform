import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWosAI } from './core';

const io = vi.hoisted(() => ({
  search: vi.fn(), overview: vi.fn(), details: vi.fn(), provinces: vi.fn(),
  gate: vi.fn(), knowledge: vi.fn(), hotel: vi.fn(), llm: vi.fn(),
  database: vi.fn(), state: vi.fn(), fetch: vi.fn(),
}));
vi.mock('./programs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./programs')>();
  return { ...actual, searchPrograms: io.search, searchHealthProgramOverview: io.overview,
    getProgramDetails: io.details, getCatalogProvinces: io.provinces };
});
vi.mock('./understanding/state', () => ({
  loadState: io.state, loadProvinces: io.state, clearPendingService: io.state,
  clearState: io.state, setCurrentProvince: io.state, saveState: io.state,
  replacePendingService: io.state, logAiRequest: io.state,
}));
vi.mock('@/lib/supabase/server', () => ({ createAnonClient: io.database }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: io.database }));
vi.mock('./understanding/gate', () => ({ runUnderstandingGate: io.gate }));
vi.mock('./notion-knowledge', () => ({ searchWosNotionKnowledge: io.knowledge }));
vi.mock('./hotel-availability', () => ({ searchHotelAvailability: io.hotel }));
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: io.llm } }; },
}));

beforeEach(() => {
  for (const mock of Object.values(io)) {
    mock.mockReset().mockImplementation(() => { throw new Error('Unexpected fixture boundary'); });
  }
  io.gate.mockResolvedValue({ handled: false });
  io.knowledge.mockRejectedValue(new Error('fixture-knowledge-unavailable'));
  for (const mock of [io.search, io.overview, io.details, io.provinces]) {
    mock.mockRejectedValue(new Error('fixture-catalog-unavailable'));
  }
  vi.stubGlobal('fetch', io.fetch);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectSafeFailure(reply: string, language: 'th' | 'lo') {
  // Assert customer-facing meaning independently of the production reply builder.
  expect(reply).toMatch(language === 'lo' ? /ຂໍ້ມູນ.*ຢືນຢັນ/ : /ข้อมูล.*ยืนยัน/);
  expect(reply).toContain('WOS');
  expect(reply).not.toMatch(/fixture-|Unexpected fixture|Error:|500|503|524|1500|1,500/);
  expect(reply).not.toMatch(/ส่งข้อมูล.*สำเร็จ|จอง.*สำเร็จ|ສຳເລັດ|confirmed booking/i);
  expect(io.database).not.toHaveBeenCalled();
  expect(io.state).not.toHaveBeenCalled();
  expect(io.hotel).not.toHaveBeenCalled();
  expect(io.fetch).not.toHaveBeenCalled();
}

describe('Thai/Lao failure responses with isolated external adapters', () => {
  it.each([
    ['th', 'ขอข้อมูลเกี่ยวกับ WOS เพิ่มเติมหน่อย', 503, 3],
    ['lo', 'ຂໍຂໍ້ມູນກ່ຽວກັບ WOS ເພີ່ມແດ່', 503, 3],
    ['th', 'ขอข้อมูลเกี่ยวกับ WOS เพิ่มเติมหน่อย', 524, 1],
    ['lo', 'ຂໍຂໍ້ມູນກ່ຽວກັບ WOS ເພີ່ມແດ່', 524, 1],
  ] as const)('%s keeps a safe response for %s after provider status %i', async (language, message, status, attempts) => {
    io.llm.mockRejectedValue(Object.assign(new Error('fixture-provider-unavailable'), { status }));
    const reply = await runWosAI(message, []);
    expect(io.llm).toHaveBeenCalledTimes(attempts);
    expect(io.knowledge).toHaveBeenCalled();
    expectSafeFailure(reply, language);
  });

  it.each([
    ['th', 'มีโปรแกรมตรวจเข่าไหม'],
    ['lo', 'ມີໂປຣແກຣມກວດສຸຂະພາບຢູ່ແຂວງອຸດອນທານີບໍ'],
  ] as const)('%s does not invent inventory when the catalog is unavailable', async (language, message) => {
    const reply = await runWosAI(message, []);
    expect(io.search).toHaveBeenCalled();
    expectSafeFailure(reply, language);
  });
});
