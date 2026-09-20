import { NextResponse } from 'next/server';
import { runWosAI } from '@/lib/ai/core';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = body?.message;

    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { error: 'message is required' },
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
