import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';
import { WEB_SESSION_COOKIE, WebOwnershipError } from '@/lib/ai/web-ownership';
const io = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/ai/web-ownership', async original => ({ ...await original<typeof import('@/lib/ai/web-ownership')>(), createWebConversation: io.create }));
beforeEach(() => vi.resetAllMocks());
it('returns selector only, credential only in protected cookie', async () => {
  io.create.mockResolvedValue({ selector: 'public-selector', newCredential: 'private-credential' });
  const r = await POST(new Request('https://www.wos.asia/api/ai/conversations', { method: 'POST' }));
  expect(r.status).toBe(201); expect(await r.json()).toEqual({ conversationSelector: 'public-selector' });
  const cookie = r.headers.get('set-cookie')!;
  for (const flag of [WEB_SESSION_COOKIE, 'HttpOnly', 'Secure', 'SameSite=lax', 'Path=/']) expect(cookie).toContain(flag);
  expect(cookie).not.toContain('Domain=');
});
it('does not rotate an existing session cookie', async () => {
  io.create.mockResolvedValue({ selector: 'public-selector' });
  const r = await POST(new Request('https://www.wos.asia/api/ai/conversations'));
  expect(r.headers.get('set-cookie')).toBeNull();
});
it('creation transaction failure exposes no usable selector/cookie', async () => {
  io.create.mockRejectedValue(new WebOwnershipError(503));
  const r = await POST(new Request('https://www.wos.asia/api/ai/conversations'));
  expect(r.status).toBe(503); expect(r.headers.get('set-cookie')).toBeNull();
  expect(await r.json()).toEqual({ error: 'Web conversation unavailable' });
});
