import { createHash, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

// Dedicated host-only credential. Never send its value to AI or diagnostic logs.
export const WEB_SESSION_COOKIE = '__Host-wos-ai-session';
export const WEB_SESSION_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 86400 };
const credentialPattern = /^[A-Za-z0-9_-]{43}$/;
const selectorPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class WebOwnershipError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 404 | 503) { super('Web conversation unavailable'); }
}

export function verifyWebOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const trusted = ['https://www.wos.asia', 'https://wos.asia'];
  // package.json's actual development server is next dev -p 3001.
  if (process.env.NODE_ENV === 'development') trusted.push('http://localhost:3001');
  if (!origin) throw new WebOwnershipError(403);
  try {
    const parsed = new URL(origin);
    // URL.origin canonicalizes the effective port (e.g. HTTPS :443).
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash
      || !trusted.includes(parsed.origin)) throw new WebOwnershipError(403);
  } catch { throw new WebOwnershipError(403); }
}

function credential(request: Request): string | undefined {
  // The chat handler has already consumed request.text(); do not clone its body.
  return new NextRequest(request.url, { headers: request.headers }).cookies.get(WEB_SESSION_COOKIE)?.value;
}
function verifier(raw: string): string {
  if (!credentialPattern.test(raw)) throw new WebOwnershipError(401);
  return createHash('sha256').update(raw).digest('hex');
}
async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new WebOwnershipError(503);
    const result = data as Record<string, unknown>;
    if (result.status === 401 || result.status === 404) throw new WebOwnershipError(result.status);
    if (result.status !== 200) throw new WebOwnershipError(503);
    return result;
  } catch (error) {
    if (error instanceof WebOwnershipError) throw error;
    throw new WebOwnershipError(503);
  }
}

export async function createWebConversation(request: Request): Promise<{ selector: string; newCredential?: string }> {
  verifyWebOrigin(request);
  const existing = credential(request);
  const raw = existing ?? randomBytes(32).toString('base64url');
  const result = await call('web_ai_create_conversation', { p_verifier: verifier(raw), p_new_session: existing === undefined });
  if (typeof result.selector !== 'string' || !selectorPattern.test(result.selector)) throw new WebOwnershipError(503);
  return { selector: result.selector, ...(existing === undefined ? { newCredential: raw } : {}) };
}

export async function authorizeWebConversation(request: Request, selector: unknown): Promise<string> {
  verifyWebOrigin(request);
  if (typeof selector !== 'string' || !selectorPattern.test(selector)) throw new WebOwnershipError(400);
  const raw = credential(request);
  if (!raw) throw new WebOwnershipError(401);
  const result = await call('web_ai_admit', { p_verifier: verifier(raw), p_selector: selector });
  if (typeof result.internal_id !== 'string' || !/^web:[0-9a-f-]{36}$/.test(result.internal_id)) throw new WebOwnershipError(503);
  return result.internal_id;
}
