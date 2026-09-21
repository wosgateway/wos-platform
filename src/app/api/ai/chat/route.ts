import { NextResponse } from 'next/server';
import { runWosAI } from '@/lib/ai/core';
import { simpleRateLimit } from '@/lib/rate-limit';

// Multiple tool rounds + Notion + OpenAI can exceed the default limit.
export const maxDuration = 60;

const MAX_MESSAGE_LENGTH = 1000;
const RATE_LIMIT_MAX = 20; // requests
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes, per IP

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
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
        return NextResponse.json(
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

    const body = await request.json();
    const message = body?.message;

    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { error: 'message is required' },
        { status: 400 }
      );
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` },
        { status: 400 }
      );
    }

    const answer = await runWosAI(message.trim());

    return NextResponse.json({
      answer,
    });
  } catch (error) {
    console.error('[AI_CHAT_ERROR]', error);

    return NextResponse.json(
      { error: 'AI service temporarily unavailable' },
      { status: 500 }
    );
  }
}
