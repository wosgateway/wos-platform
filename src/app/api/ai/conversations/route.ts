import { NextResponse } from 'next/server';
import { createWebConversation, WebOwnershipError, WEB_SESSION_COOKIE, WEB_SESSION_OPTIONS } from '@/lib/ai/web-ownership';

export async function POST(request: Request) {
  try {
    const { selector, newCredential } = await createWebConversation(request);
    const response = NextResponse.json({ conversationSelector: selector }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    if (newCredential) response.cookies.set(WEB_SESSION_COOKIE, newCredential, WEB_SESSION_OPTIONS);
    return response;
  } catch (error) {
    return NextResponse.json({ error: 'Web conversation unavailable' }, {
      status: error instanceof WebOwnershipError ? error.status : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
