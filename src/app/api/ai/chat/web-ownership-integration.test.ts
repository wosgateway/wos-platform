import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { POST } from './route';
import { WEB_SESSION_COOKIE } from '@/lib/ai/web-ownership';
const io = vi.hoisted(() => ({ core: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/ai/core', () => ({ runWosAI: io.core }));
vi.mock('@/lib/rate-limit', () => ({ simpleRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: io.rpc }) }));
const selector = '8c3d8320-80de-453e-94d3-83dd24ca012d';
const credential = 'a'.repeat(43);
const internal = 'web:14f0b547-4aa4-48f1-997b-fe6d1fc54741';
const req = (raw = credential, selected = selector, origin = 'https://www.wos.asia') => new Request('https://www.wos.asia/api/ai/chat', {
  method: 'POST', headers: { origin, cookie: `${WEB_SESSION_COOKIE}=${raw}` },
  body: JSON.stringify({ message: 'hello', conversationSelector: selected }),
});
beforeEach(() => { vi.resetAllMocks(); io.core.mockResolvedValue('answer'); });
it('real route + verifier hand off the same trusted key on both turns', async () => {
  io.rpc.mockResolvedValue({ data: { status: 200, internal_id: internal }, error: null });
  for (let i=0;i<2;i++) expect((await POST(req())).status).toBe(200);
  expect(io.core).toHaveBeenCalledTimes(2);
  expect(io.core).toHaveBeenCalledWith('hello', [], expect.objectContaining({ conversationId: internal, channel: 'web' }));
});
it('different session cannot replay the owned selector (store response mocked)', async () => {
  const ownerHash = createHash('sha256').update(credential).digest('hex');
  io.rpc.mockImplementation(async (_name, args) => ({ data: args.p_verifier === ownerHash
    ? { status: 200, internal_id: internal } : { status: 404 }, error: null }));
  expect((await POST(req('b'.repeat(43)))).status).toBe(404);
  expect(io.core).not.toHaveBeenCalled();
});
it('bad origin and Chatwoot selector cannot reach ownership store or core', async () => {
  expect((await POST(req(credential, selector, 'https://evil.example'))).status).toBe(403);
  expect((await POST(req(credential, '123'))).status).toBe(400);
  expect(io.rpc).not.toHaveBeenCalled(); expect(io.core).not.toHaveBeenCalled();
});
