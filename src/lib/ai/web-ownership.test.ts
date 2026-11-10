import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { authorizeWebConversation, createWebConversation, WEB_SESSION_COOKIE, WEB_SESSION_OPTIONS } from './web-ownership';

const io = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: io.rpc }) }));
const selector = '8c3d8320-80de-453e-94d3-83dd24ca012d';
const internal = 'web:8c3d8320-80de-453e-94d3-83dd24ca012d';
const raw = 'a'.repeat(43);
const request = (origin: string | null = 'https://www.wos.asia', cookie: string | null = raw) => new Request('https://www.wos.asia/api/ai/chat', {
  method: 'POST', headers: { ...(origin === null ? {} : { origin }), ...(cookie === null ? {} : { cookie: `${WEB_SESSION_COOKIE}=${cookie}` }) },
});
beforeEach(() => { vi.resetAllMocks(); io.rpc.mockResolvedValue({ data: { status: 200, internal_id: internal, selector }, error: null }); });
describe('web ownership boundary (RPC mocked; does not prove SQL lifecycle/locking)', () => {
  it('owned conversation resolves the same internal ID on both turns', async () => {
    expect(await authorizeWebConversation(request(), selector)).toBe(internal);
    expect(await authorizeWebConversation(request(), selector)).toBe(internal);
    expect(io.rpc).toHaveBeenCalledWith('web_ai_admit', { p_verifier: createHash('sha256').update(raw).digest('hex'), p_selector: selector });
    expect(JSON.stringify(io.rpc.mock.calls)).not.toContain(raw);
  });
  it('accepts cookie after the chat route has consumed the JSON body', async () => {
    const r = new Request('https://www.wos.asia/api/ai/chat', { method: 'POST', headers: request().headers,
      body: JSON.stringify({ message: 'hello', conversationSelector: selector }) });
    await r.text();
    expect(await authorizeWebConversation(r, selector)).toBe(internal);
  });
  it.each(['foreign', 'unknown', 'expired conversation', 'revoked conversation'])('propagates generic denial: %s', async () => {
    io.rpc.mockResolvedValue({ data: { status: 404 }, error: null });
    await expect(authorizeWebConversation(request(), selector)).rejects.toMatchObject({ status: 404 });
  });
  it.each(['invalid', 'idle expired', 'absolute expired', 'revoked'])('propagates session denial: %s', async () => {
    io.rpc.mockResolvedValue({ data: { status: 401 }, error: null });
    await expect(authorizeWebConversation(request(), selector)).rejects.toMatchObject({ status: 401 });
  });
  it.each([undefined, null, '', '123', internal, {}, selector.toUpperCase()])('rejects malformed/Chatwoot/internal selector before RPC: %j', async value => {
    await expect(authorizeWebConversation(request(), value)).rejects.toMatchObject({ status: 400 });
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it.each([null, 'null', 'https://evil.example', 'https://www.wos.asia.evil.example', 'https://www.wos.asia:444'])('denies Origin %s before issuance/admission', async origin => {
    await expect(createWebConversation(request(origin))).rejects.toMatchObject({ status: 403 });
    await expect(authorizeWebConversation(request(origin), selector)).rejects.toMatchObject({ status: 403 });
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it('does not trust forwarded host', async () => {
    const r = request('https://evil.example'); r.headers.set('x-forwarded-host', 'www.wos.asia');
    await expect(authorizeWebConversation(r, selector)).rejects.toMatchObject({ status: 403 });
  });
  it('matches effective HTTPS port and permits both approved production origins', async () => {
    for (const origin of ['https://www.wos.asia:443', 'https://wos.asia'])
      expect(await authorizeWebConversation(request(origin), selector)).toBe(internal);
  });
  it('same session may select multiple conversations; selector is never the state key', async () => {
    const second = '14f0b547-4aa4-48f1-997b-fe6d1fc54741';
    io.rpc.mockImplementation(async (_name, args) => ({ data: { status: 200, internal_id: `web:${args.p_selector}` }, error: null }));
    expect(await authorizeWebConversation(request(), selector)).toBe(`web:${selector}`);
    expect(await authorizeWebConversation(request(), second)).toBe(`web:${second}`);
    expect(io.rpc.mock.calls[0][1].p_verifier).toBe(io.rpc.mock.calls[1][1].p_verifier);
  });
  it('requires credential, does not create replacement session', async () => {
    await expect(authorizeWebConversation(request(undefined, null), selector)).rejects.toMatchObject({ status: 401 });
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it('malformed existing credential is not replaced', async () => {
    await expect(createWebConversation(request(undefined, 'bad'))).rejects.toMatchObject({ status: 401 });
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it('issues 32 bytes, stores only SHA256, uses secure host cookie policy', async () => {
    const result = await createWebConversation(request(undefined, null));
    expect(Buffer.from(result.newCredential!, 'base64url')).toHaveLength(32);
    expect(io.rpc).toHaveBeenCalledWith('web_ai_create_conversation', { p_verifier: createHash('sha256').update(result.newCredential!).digest('hex'), p_new_session: true });
    expect(WEB_SESSION_OPTIONS).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 86400 });
    expect(WEB_SESSION_COOKIE.startsWith('__Host-')).toBe(true);
  });
  it('existing session creates another conversation without rotation', async () => {
    expect(await createWebConversation(request())).toEqual({ selector });
    expect(io.rpc.mock.calls[0][1].p_new_session).toBe(false);
  });
  it.each(['create', 'admit'])('store failure fails closed: %s', async operation => {
    io.rpc.mockResolvedValue({ data: null, error: { message: 'private store failure' } });
    await expect(operation === 'create' ? createWebConversation(request()) : authorizeWebConversation(request(), selector)).rejects.toMatchObject({ status: 503 });
  });
  it('unexpected internal ID cannot reach core', async () => {
    io.rpc.mockResolvedValue({ data: { status: 200, internal_id: '123' }, error: null });
    await expect(authorizeWebConversation(request(), selector)).rejects.toMatchObject({ status: 503 });
  });
});
