import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

import type { WosJourneyState } from '@/lib/ai/journey-state';
import { buildHandoffKey, processOutbox, submitHandoff } from './service';

const journey = { needs: ['health'] } as unknown as WosJourneyState;
const input = () => ({
  conversationId: 'conv-123', language: 'th' as const, name: 'สมชาย',
  contactChannel: 'phone' as const, contactValue: '081-234-5678', country: 'TH', journey,
});

type QueryMock = {
  update: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function queryMock(result: unknown = { error: null }): QueryMock {
  const q = {} as QueryMock;
  q.update = vi.fn(() => q);
  q.select = vi.fn(() => q);
  q.eq = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  q.update.mockImplementation(() => q);
  q.eq.mockImplementation(() => q);
  void result;
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = '12345';
  delete process.env.TELEGRAM_HANDOFF_CHAT_ID;
  mocks.from.mockReturnValue(queryMock());
});

describe('buildHandoffKey', () => {
  it('is deterministic and normalizes phone formatting', () => {
    expect(buildHandoffKey('c1', 'phone', '081-234-5678')).toBe(buildHandoffKey('c1', 'phone', '081 234 5678'));
    expect(buildHandoffKey('c1', 'phone', '0812345678')).not.toBe(buildHandoffKey('c2', 'phone', '0812345678'));
  });
});

describe('submitHandoff', () => {
  it('rejects invalid input before touching DB', async () => {
    const result = await submitHandoff({ ...input(), name: '' });
    expect(result).toEqual({ ok: false, reason: 'validation', field: 'name' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns db_error when submit RPC fails', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
    const result = await submitHandoff(input());
    expect(result).toEqual({ ok: false, reason: 'db_error' });
    expect(mocks.rpc).toHaveBeenCalledWith('submit_ai_handoff', expect.objectContaining({
      p_idempotency_key: expect.stringMatching(/^ai:/), p_contact_value: '081-234-5678',
    }));
  });

  it('returns db_error when submit RPC throws', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('connection lost'));
    const result = await submitHandoff(input());
    expect(result).toEqual({ ok: false, reason: 'db_error' });
  });

  it('saves a new lead and reports Telegram sent', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { id: 'req-1', created: true }, error: null })
      .mockResolvedValueOnce({ data: [{ id: 'out-1', consultation_request_id: 'req-1', channel: 'telegram', payload: { text: 'hello' }, attempts: 1, max_attempts: 5 }], error: null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const result = await submitHandoff(input());
    expect(result).toEqual({ ok: true, requestId: 'req-1', created: true, notification: 'sent' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalled();
  });

  it('keeps the lead successful when Telegram fails', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { id: 'req-2', created: true }, error: null })
      .mockResolvedValueOnce({ data: [{ id: 'out-2', consultation_request_id: 'req-2', channel: 'telegram', payload: { text: 'hello' }, attempts: 1, max_attempts: 5 }], error: null });
    const q = queryMock();
    mocks.from.mockReturnValue(q);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 500 })));
    const result = await submitHandoff(input());
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ requestId: 'req-2', created: true, notification: 'queued' });
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('handles duplicate lead and existing sent notification', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { id: 'req-3', created: false }, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const q = queryMock();
    q.maybeSingle.mockResolvedValueOnce({ data: { status: 'sent' }, error: null });
    mocks.from.mockReturnValue(q);
    const result = await submitHandoff(input());
    expect(result).toEqual({ ok: true, requestId: 'req-3', created: false, notification: 'sent' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('processOutbox', () => {
  it('returns empty stats when claim fails', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'claim failed' } });
    await expect(processOutbox()).resolves.toEqual({ claimed: 0, sent: 0, failed: 0, dead: 0 });
  });

  it('marks a claimed Telegram row sent after successful delivery', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ id: 'o1', consultation_request_id: 'r1', channel: 'telegram', payload: { text: 'hi' }, attempts: 1, max_attempts: 5 }], error: null });
    const q = queryMock(); mocks.from.mockReturnValue(q);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const stats = await processOutbox({ limit: 1 });
    expect(stats).toEqual({ claimed: 1, sent: 1, failed: 0, dead: 0 });
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', locked_at: null, last_error: null }));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('marks a failed Telegram delivery as failed', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ id: 'o2', consultation_request_id: 'r2', channel: 'telegram', payload: { text: 'hi' }, attempts: 1, max_attempts: 5 }], error: null });
    const q = queryMock(); mocks.from.mockReturnValue(q);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 503 })));
    const stats = await processOutbox();
    expect(stats).toEqual({ claimed: 1, sent: 0, failed: 1, dead: 0 });
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', locked_at: null }));
  });

  it('marks exhausted attempts dead', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ id: 'o3', consultation_request_id: 'r3', channel: 'telegram', payload: { text: 'hi' }, attempts: 5, max_attempts: 5 }], error: null });
    const q = queryMock(); mocks.from.mockReturnValue(q);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 500 })));
    const stats = await processOutbox();
    expect(stats).toEqual({ claimed: 1, sent: 0, failed: 0, dead: 1 });
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'dead' }));
  });

  it('does not call Telegram for malformed payload or unsupported channel', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ id: 'o4', consultation_request_id: 'r4', channel: 'telegram', payload: {}, attempts: 1, max_attempts: 5 }], error: null });
    const q = queryMock(); mocks.from.mockReturnValue(q);
    const stats = await processOutbox();
    expect(stats.failed).toBe(1); expect(fetch).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValueOnce({ data: [{ id: 'o5', consultation_request_id: 'r5', channel: 'email', payload: { text: 'x' }, attempts: 1, max_attempts: 5 }], error: null });
    const stats2 = await processOutbox();
    expect(stats2.failed).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
});

