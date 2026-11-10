import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';
import { WebOwnershipError } from '@/lib/ai/web-ownership';
const io = vi.hoisted(() => ({ core: vi.fn(), auth: vi.fn(), rate: vi.fn() }));
vi.mock('@/lib/ai/core', () => ({ runWosAI: io.core }));
vi.mock('@/lib/rate-limit', () => ({ simpleRateLimit: io.rate }));
vi.mock('@/lib/ai/web-ownership', async original => ({ ...await original<typeof import('@/lib/ai/web-ownership')>(), authorizeWebConversation: io.auth }));
const internal = 'web:8c3d8320-80de-453e-94d3-83dd24ca012d';
const request = (body: object) => new Request('https://www.wos.asia/api/ai/chat', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); io.core.mockResolvedValue('answer'); io.rate.mockResolvedValue({ allowed: true }); io.auth.mockResolvedValue(internal); });
it('preserves stateless call shape and response', async () => {
  const response = await POST(request({ message: 'hello', history: [] }));
  expect(await response.json()).toEqual({ answer: 'answer' });
  expect(io.auth).not.toHaveBeenCalled();
  expect(io.core.mock.calls[0].slice(0, 2)).toEqual(['hello', []]);
  expect(io.core.mock.calls[0][2]?.conversationId).toBeUndefined();
  expect(io.core.mock.calls[0][2]?.channel).toBeUndefined();
});
it('two stateful turns pass only authorized internal ID and web channel', async () => {
  for (let i=0;i<2;i++) expect((await POST(request({ message: 'hello', conversationSelector: 'selector' }))).status).toBe(200);
  expect(io.core).toHaveBeenCalledTimes(2);
  expect(io.core).toHaveBeenCalledWith('hello', [], expect.objectContaining({ conversationId: internal, channel: 'web' }));
});
it.each([400,401,403,404,503] as const)('auth failure %s never downgrades or calls core', async status => {
  io.auth.mockRejectedValue(new WebOwnershipError(status));
  expect((await POST(request({ message: 'hello', conversationSelector: 'selector' }))).status).toBe(status);
  expect(io.core).not.toHaveBeenCalled();
});
it.each([{ conversationId: '123' }, { conversation_id: '123' }, { conversationSelector: 'selector', conversationId: '123' }])('rejects direct internal identity %j', async context => {
  expect((await POST(request({ message: 'hello', ...context }))).status).toBe(400);
  expect(io.auth).not.toHaveBeenCalled(); expect(io.core).not.toHaveBeenCalled();
});
