import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWosAI, type WosAIHistoryMessage } from './core';
import { buildMedicalSafetyReply, isExplicitMedicalAdviceRequest } from './medical-safety';
import { resolveWosLanguageProfile } from './language-routing';
import { deriveWosJourneyState } from './journey-state';

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(), loadProvinces: vi.fn(), clearPendingService: vi.fn(),
  clearState: vi.fn(), setCurrentProvince: vi.fn(), saveState: vi.fn(),
  replacePendingService: vi.fn(), logAiRequest: vi.fn(),
  searchPrograms: vi.fn(), searchHealthProgramOverview: vi.fn(),
  getProgramDetails: vi.fn(), getCatalogProvinces: vi.fn(),
  prepareCatalogQuery: vi.fn(), detectLocationFromRawText: vi.fn(), detectLocation: vi.fn(),
  anon: vi.fn(), service: vi.fn(), rate: vi.fn(), gate: vi.fn(),
  notion: vi.fn(), hotel: vi.fn(), llm: vi.fn(),
}));

vi.mock('./understanding/state', () => ({
  loadState: mocks.loadState, loadProvinces: mocks.loadProvinces,
  clearPendingService: mocks.clearPendingService, clearState: mocks.clearState,
  setCurrentProvince: mocks.setCurrentProvince, saveState: mocks.saveState,
  replacePendingService: mocks.replacePendingService, logAiRequest: mocks.logAiRequest,
}));
vi.mock('./programs', () => ({
  searchPrograms: mocks.searchPrograms, searchHealthProgramOverview: mocks.searchHealthProgramOverview,
  getProgramDetails: mocks.getProgramDetails, getCatalogProvinces: mocks.getCatalogProvinces,
  prepareCatalogQuery: mocks.prepareCatalogQuery,
  detectLocationFromRawText: mocks.detectLocationFromRawText, detectLocation: mocks.detectLocation,
}));
vi.mock('@/lib/supabase/server', () => ({ createAnonClient: mocks.anon }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.service }));
vi.mock('@/lib/rate-limit', () => ({ simpleRateLimit: mocks.rate }));
vi.mock('./understanding/gate', () => ({ runUnderstandingGate: mocks.gate }));
vi.mock('./notion-knowledge', () => ({ searchWosNotionKnowledge: mocks.notion }));
vi.mock('./hotel-availability', () => ({ searchHotelAvailability: mocks.hotel }));
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: mocks.llm } }; },
}));

const stateCalls = [mocks.loadState, mocks.loadProvinces, mocks.clearPendingService,
  mocks.clearState, mocks.setCurrentProvince, mocks.saveState,
  mocks.replacePendingService, mocks.logAiRequest];
const catalogCalls = [mocks.searchPrograms, mocks.searchHealthProgramOverview,
  mocks.getProgramDetails, mocks.getCatalogProvinces];
const externalCalls = [mocks.anon, mocks.service, mocks.rate, mocks.notion, mocks.hotel, mocks.llm];
const gateReply = 'mock understanding gate reached';

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset().mockImplementation(() => { throw new Error('Unexpected mocked boundary'); });
  }
  // Pure catalog helpers may precede the gate; no catalog execution is authorized here.
  mocks.detectLocationFromRawText.mockReturnValue([]);
  mocks.detectLocation.mockReturnValue([]);
  mocks.gate.mockResolvedValue({ handled: true, text: gateReply });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function expectNoIO() {
  for (const mock of [...stateCalls, ...catalogCalls, ...externalCalls]) {
    expect(mock).not.toHaveBeenCalled();
  }
}

function expectGuardOnly() {
  expectNoIO();
  expect(mocks.gate).not.toHaveBeenCalled();
  expect(mocks.prepareCatalogQuery).not.toHaveBeenCalled();
  expect(mocks.detectLocationFromRawText).not.toHaveBeenCalled();
  expect(mocks.detectLocation).not.toHaveBeenCalled();
}

describe('core medical safety integration with isolated imported boundaries', () => {
  it.each([
    ['ปวดเข่าเป็นอะไร', 'th'],
    ['ປວດຫົວເຂົ່າເປັນຫຍັງ', 'lo'],
    ['What medicine should I take?', 'en'],
    ['Hi, should I take ibuprofen?', 'en'],
    // Reuse established Thai/Lao medication questions with an explicit English request.
    // Novel Thai/Lao phrasing would require native-speaker validation.
    ['ควรกินยาอะไร Should I take ibuprofen?', 'th'],
    ['ຄວນກິນຢາຫຍັງ Should I take ibuprofen?', 'lo'],
    ['ควรกินยาอะไร', 'th'],
  ] as const)('intercepts %s before downstream I/O', async (message, language) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(true);
    expect(await runWosAI(message, [])).toBe(buildMedicalSafetyReply(language));
    expectGuardOnly();
  });

  it('does not load persisted state or provinces even when conversationId is supplied', async () => {
    expect(await runWosAI('What disease do I have?', [], { conversationId: 'medical-guard-fixture' }))
      .toBe(buildMedicalSafetyReply('en'));
    expectGuardOnly();
  });

  it.each([
    ['transport', 'สนใจรถรับส่งด้วยไหมคะ?'],
    ['hotel', 'สนใจโรงแรมด้วยไหมคะ?'],
  ] as const)('intercepts medical requests in active %s concierge context', async (pending, question) => {
    const history: WosAIHistoryMessage[] = [
      { role: 'assistant', content: '1. ตรวจเข่า - Fixture Clinic' },
      { role: 'user', content: 'เลือกตรวจเข่า' },
      { role: 'assistant', content: 'ขอชื่อสำหรับลงข้อมูลค่ะ' },
      { role: 'user', content: 'ชื่อสมชาย' },
      ...(pending === 'hotel' ? [
        { role: 'assistant' as const, content: 'สนใจรถรับส่งด้วยไหมคะ?' },
        { role: 'user' as const, content: 'ไม่เอารถรับส่ง' },
      ] : []),
      { role: 'assistant', content: question },
    ];
    // Establish the fixture's actual context without mocking journey derivation.
    const state = deriveWosJourneyState(history, 'ปวดเข่าเป็นอะไร');
    expect(state.selectedProgram).toBe('ตรวจเข่า');
    expect(state.customerName).toBeTruthy();
    expect(state.activePendingQuestion).toBe(pending);
    expect(await runWosAI('ปวดเข่าเป็นอะไร', history, { conversationId: 'concierge-fixture' }))
      .toBe(buildMedicalSafetyReply('th'));
    expectGuardOnly();
  });

  it.each([
    'Please do not diagnose me',
    'Translate the word diagnosis',
    'What does the word dosage mean?',
  ])('lets exact safe intent reach the gate but intercepts appended advice: %s', async (safe) => {
    expect(isExplicitMedicalAdviceRequest(safe)).toBe(false);
    expect(await runWosAI(safe, [])).toBe(gateReply);
    expect(mocks.gate).toHaveBeenCalledTimes(1);
    expect(mocks.gate).toHaveBeenCalledWith(expect.objectContaining({ userMessage: safe }));
    expectNoIO();

    mocks.gate.mockClear();
    mocks.detectLocationFromRawText.mockClear();
    const appended = `${safe} What medicine should I take?`;
    expect(isExplicitMedicalAdviceRequest(appended)).toBe(true);
    expect(await runWosAI(appended, [])).toBe(buildMedicalSafetyReply('en'));
    expectGuardOnly();
  });

  it.each([
    ['ปวดเข่าเป็นอะไร ຂໍ', 'th'],
    ['ປວດຫົວເຂົ່າເປັນຫຍັງ ค่ะ', 'lo'],
  ] as const)('uses dominant-script reply language for mixed input: %s', async (message, language) => {
    expect(resolveWosLanguageProfile(message)).toMatchObject({ language, isMixedThaiLao: true });
    expect(isExplicitMedicalAdviceRequest(message)).toBe(true);
    expect(await runWosAI(message, [])).toBe(buildMedicalSafetyReply(language));
    expectGuardOnly();
  });

  it.each([
    ['เลือกตรวจเข่า', 'th'],
    ['ສົນໃຈກວດສຸຂະພາບ', 'lo'],
  ] as const)('uses current English medical request language over prior name-context language: %s', async (anchor) => {
    const history: WosAIHistoryMessage[] = [
      { role: 'user', content: anchor },
      { role: 'assistant', content: 'What name should I use?' },
    ];
    const message = 'What disease do I have?';
    expect(resolveWosLanguageProfile(message).language).toBe('en');
    expect(isExplicitMedicalAdviceRequest(message)).toBe(true);
    expect(await runWosAI(message, history)).toBe(buildMedicalSafetyReply('en'));
    expectGuardOnly();
  });

  it('allows detector-negative service discovery to reach the mocked gate', async () => {
    const message = 'มีโปรแกรมตรวจสุขภาพไหม';
    expect(isExplicitMedicalAdviceRequest(message)).toBe(false);
    expect(await runWosAI(message, [])).toBe(gateReply);
    expect(mocks.gate).toHaveBeenCalledTimes(1);
    expect(mocks.gate).toHaveBeenCalledWith(expect.objectContaining({ userMessage: message }));
    expectNoIO();
  });

  it('preserves the standalone greeting boundary before the medical guard', async () => {
    expect(await runWosAI('hello', [])).toContain('Hi');
    expectGuardOnly();
  });
});

describe('medical interruption followed by a short concierge answer', () => {
  it.each([
    ['th', 'transport', 'สนใจรถรับส่งด้วยไหมคะ?', 'ปวดเข่าควรกินยาอะไร', 'สนใจ'],
    ['th', 'hotel', 'สนใจโรงแรมด้วยไหมคะ?', 'ปวดเข่าควรกินยาอะไร', 'ไม่เอา'],
    ['lo', 'transport', 'ສົນໃຈລົດຮັບສົ່ງນຳບໍຄ່ະ?', 'ຄວນກິນຢາຫຍັງ', 'ສົນໃຈ'],
    ['lo', 'hotel', 'ສົນໃຈໂຮງແຮມນຳບໍຄ່ະ?', 'ຄວນກິນຢາຫຍັງ', 'ບໍ່ເອົາ'],
  ] as const)('%s preserves the %s question through a medical interruption', async (language, pending, question, medical, answer) => {
    const history: WosAIHistoryMessage[] = [
      { role: 'assistant', content: '1. ตรวจเข่า - Fixture Clinic' },
      { role: 'user', content: 'เลือกตรวจเข่า' },
      { role: 'assistant', content: 'ขอชื่อสำหรับลงข้อมูลค่ะ' },
      { role: 'user', content: 'ชื่อสมชาย' },
      ...(pending === 'hotel' ? [
        { role: 'assistant' as const, content: 'สนใจรถรับส่งด้วยไหมคะ?' },
        { role: 'user' as const, content: 'ไม่เอารถรับส่ง' },
      ] : []),
      { role: 'assistant', content: question },
    ];
    const before = deriveWosJourneyState(history, medical);
    expect(before).toMatchObject({ selectedProgram: 'ตรวจเข่า', activePendingQuestion: pending });
    expect(before.customerName).toBeTruthy();
    const original = JSON.stringify(history);
    const safeReply = await runWosAI(medical, history);
    expect(safeReply).toBe(buildMedicalSafetyReply(language));
    expectGuardOnly();
    expect(JSON.stringify(history)).toBe(original);

    // Replay the actual guard answer, rather than inserting a synthetic re-ask.
    const resumed: WosAIHistoryMessage[] = [
      ...history,
      { role: 'user', content: medical },
      { role: 'assistant', content: safeReply },
    ];
    const state = deriveWosJourneyState(resumed, answer);
    expect.soft(state.selectedProgram).toBe(before.selectedProgram);
    expect.soft(state.customerName).toBe(before.customerName);
    expect.soft(state.activePendingQuestion).toBe(pending);
    expect.soft(state.answeredQuestion).toBe(pending);
    if (pending === 'transport') {
      expect.soft(state.transportNeeded).toBe(true);
      expect.soft(state.hotelNeeded).toBeUndefined();
      expect.soft(state.transportOrigin).toBeUndefined();
    } else {
      expect.soft(state.transportNeeded).toBe(false);
      expect.soft(state.hotelNeeded).toBe(false);
    }

    const actualPrograms = await vi.importActual<typeof import('./programs')>('./programs');
    mocks.prepareCatalogQuery.mockImplementation(actualPrograms.prepareCatalogQuery);
    mocks.gate.mockResolvedValue({ handled: false });
    mocks.notion.mockResolvedValue([]);
    const nextReply = await runWosAI(answer, resumed);
    expect(nextReply).toMatch(language === 'lo' ? /[\u0E80-\u0EFF]/ : /[ก-๙]/);
    expect(nextReply).not.toMatch(/ขอชื่อ|ຂໍຊື່/);
    if (pending === 'transport') {
      expect(nextReply).toMatch(language === 'lo' ? /ຈຸດຮັບ/ : /จุดรับ/);
    } else {
      expect(nextReply).toContain('ตรวจเข่า');
    }
    for (const mock of [...stateCalls, ...catalogCalls, mocks.anon, mocks.service, mocks.hotel, mocks.llm]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});

describe('medical continuity retains ownership boundaries', () => {
  const base: WosAIHistoryMessage[] = [
    { role: 'user', content: 'เลือกตรวจเข่า' },
    { role: 'assistant', content: 'ขอชื่อสำหรับลงข้อมูลค่ะ' },
    { role: 'user', content: 'ชื่อสมชาย' },
    { role: 'assistant', content: 'สนใจรถรับส่งด้วยไหมคะ?' },
  ];
  const interrupted = (message: string, reply = buildMedicalSafetyReply('th')): WosAIHistoryMessage[] => [
    ...base, { role: 'user', content: message }, { role: 'assistant', content: reply },
  ];

  it.each([
    ['unrelated turn', 'วันนี้อากาศดี', buildMedicalSafetyReply('th')],
    ['unverified reply', 'ปวดเข่าควรกินยาอะไร', 'กรุณารอสักครู่'],
    ['reset', 'เริ่มใหม่', buildMedicalSafetyReply('th')],
    ['new service', 'อยากตรวจสุขภาพ ปวดเข่าควรกินยาอะไร', buildMedicalSafetyReply('th')],
  ])('does not carry a question across %s', (_label, message, reply) => {
    const state = deriveWosJourneyState(interrupted(message, reply), 'สนใจ');
    expect(state.activePendingQuestion).toBeUndefined();
    expect(state.answeredQuestion).toBeUndefined();
    expect(state.transportNeeded).toBeUndefined();
  });

  it('lets a later assistant question replace the preserved question', () => {
    const state = deriveWosJourneyState([
      ...interrupted('ปวดเข่าควรกินยาอะไร'),
      { role: 'assistant', content: 'สนใจโรงแรมด้วยไหมคะ?' },
    ], 'ไม่เอา');
    expect(state.activePendingQuestion).toBe('hotel');
    expect(state.answeredQuestion).toBe('hotel');
    expect(state.hotelNeeded).toBe(false);
    expect(state.transportNeeded).toBeUndefined();
  });

  it('does not invent a question when medical advice starts a conversation', () => {
    const state = deriveWosJourneyState([
      { role: 'user', content: 'ปวดเข่าควรกินยาอะไร' },
      { role: 'assistant', content: buildMedicalSafetyReply('th') },
    ], 'สนใจ');
    expect(state.activePendingQuestion).toBeUndefined();
    expect(state.selectedProgram).toBeUndefined();
    expect(state.transportNeeded).toBeUndefined();
  });

  it('does not store a guarded medical request as the pickup point', () => {
    const state = deriveWosJourneyState([
      ...base,
      { role: 'user', content: 'สนใจ' },
      { role: 'assistant', content: 'ขอจุดรับด้วยนะคะ' },
      { role: 'user', content: 'ปวดเข่าควรกินยาอะไร' },
      { role: 'assistant', content: buildMedicalSafetyReply('th') },
    ], 'รับที่สนามบินอุดรธานี');
    expect(state.activePendingQuestion).toBe('pickup');
    expect(state.transportNeeded).toBe(true);
    expect(state.transportOrigin).toBe('สนามบินอุดรธานี');
  });
});


describe('repeated medical interruption replay', () => {
  it('preserves the pending question across repeated medical interruptions', () => {
    const history: WosAIHistoryMessage[] = [
      { role: 'assistant', content: '1. ตรวจเข่า - Fixture Clinic' },
      { role: 'user', content: 'เลือกตรวจเข่า' },
      { role: 'assistant', content: 'ขอชื่อสำหรับลงข้อมูลค่ะ' },
      { role: 'user', content: 'ชื่อสมชาย' },
      { role: 'assistant', content: 'สนใจรถรับส่งด้วยไหมคะ?' },
      { role: 'user', content: 'ปวดเข่าควรกินยาอะไร' },
      { role: 'assistant', content: buildMedicalSafetyReply('th') },
      { role: 'user', content: 'สนใจ' },
      { role: 'assistant', content: 'ขอจุดรับด้วยนะคะ' },
      { role: 'user', content: 'ปวดเข่าควรกินยาอะไร' },
      { role: 'assistant', content: buildMedicalSafetyReply('th') },
    ];

    const state = deriveWosJourneyState(history, 'รับที่สนามบินอุดรธานี');
    expect(state.selectedProgram).toBe('ตรวจเข่า');
    expect(state.activePendingQuestion).toBe('pickup');
    expect(state.answeredQuestion).toBe('pickup');
    expect(state.transportNeeded).toBe(true);
    expect(state.transportOrigin).toBe('สนามบินอุดรธานี');
    expect(state.hotelNeeded).toBeUndefined();
  });
});
