import { NextResponse } from 'next/server';
import { runWosAI } from '@/lib/ai/core';
import { simpleRateLimit } from '@/lib/rate-limit';

// Multiple tool rounds + Notion + OpenAI can exceed the default limit.
export const maxDuration = 60;

// NextResponse.json() sets "Content-Type: application/json" with no charset.
// That is valid per RFC 8259 (JSON is UTF-8 by definition), but some HTTP
// clients - notably PowerShell's Invoke-WebRequest/Invoke-RestMethod on
// Windows - fall back to a local codepage instead of UTF-8 when the header
// omits an explicit charset, which mangles Thai/Lao text on the client side
// even though the bytes we sent were correct UTF-8. Adding the charset
// removes that ambiguity for every client, so wrap every JSON response here
// instead of relying on the default.
function jsonResponse(
  data: unknown,
  init?: number | ResponseInit
) {
  const responseInit: ResponseInit =
    typeof init === 'number' ? { status: init } : init ?? {};

  const headers = new Headers(responseInit.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');

  return NextResponse.json(data, { ...responseInit, headers });
}

const MAX_MESSAGE_LENGTH = 1000;
const RATE_LIMIT_MAX = 20; // requests
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes, per IP

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

function getErrorStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

// Seconds the upstream told us to wait (works with plain-object headers and
// the Headers class, depending on the openai SDK version). Clamped so a daily
// quota reset never produces an absurd value.
function getRetryAfterSeconds(error: unknown): number {
  const headers = (error as { headers?: unknown } | null)?.headers;
  let raw: string | null | undefined;

  if (headers && typeof (headers as Headers).get === 'function') {
    raw = (headers as Headers).get('retry-after');
  } else if (headers && typeof headers === 'object') {
    raw = (headers as Record<string, string | undefined>)['retry-after'];
  }

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return 30;
  return Math.min(Math.ceil(seconds), 3600);
}

export async function POST(request: Request) {
  try {
    // This endpoint is public and every call costs OpenAI tokens.
    try {
      const limit = await simpleRateLimit(
        `ai-chat:${getClientIp(request)}`,
        RATE_LIMIT_MAX,
        RATE_LIMIT_WINDOW_MS
      );

      if (!limit.allowed) {
        return jsonResponse(
          { error: 'Too many requests. Please try again later.' },
          { status: 429 }
        );
      }
    } catch (rateLimitError) {
      // Fail open: a Redis outage should not take the assistant down.
      console.error(
        '[AI_CHAT_RATE_LIMIT_ERROR]',
        rateLimitError instanceof Error ? rateLimitError.message : rateLimitError
      );
    }

    // Parse the body ourselves so malformed JSON returns a clean 400 instead
    // of falling into the catch-all 500. The body is never logged: it is
    // customer text.
    let body: unknown;

    try {
      body = JSON.parse(await request.text());
    } catch {
      return jsonResponse(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const message =
      typeof body === 'object' && body !== null
        ? (body as { message?: unknown }).message
        : undefined;

    if (typeof message !== 'string' || !message.trim()) {
      return jsonResponse(
        { error: 'message is required' },
        { status: 400 }
      );
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return jsonResponse(
        { error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` },
        { status: 400 }
      );
    }

    const answer = await runWosAI(message.trim());

    return jsonResponse({
      answer,
    });
  } catch (error) {
    // OpenAI quota / rate limit (429): the service is healthy, it is just
    // busy or out of quota. Tell the caller to retry instead of a generic 500.
    if (getErrorStatus(error) === 429) {
      const retryAfter = getRetryAfterSeconds(error);
      console.warn('[AI_CHAT_RATE_LIMITED] upstream 429, retry after', retryAfter, 's');

      return jsonResponse(
        {
          error: 'AI service is busy',
          message:
            'The assistant is very busy right now. Please try again in a moment. / ผู้ช่วยกำลังมีผู้ใช้งานจำนวนมาก กรุณาลองอีกครั้งในอีกสักครู่ค่ะ',
        },
        { status: 503, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    console.error(
      '[AI_CHAT_ERROR]',
      error instanceof Error ? error.message : error
    );

    return jsonResponse(
      { error: 'AI service temporarily unavailable' },
      { status: 500 }
    );
  }
}
