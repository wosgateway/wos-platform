// src/app/api/mou-sign/[token]/otp/verify/route.ts
//
// POST: checks a submitted 6-digit code against the most recent
// still-active code for this sign request. Success here does NOT write
// anything permanent by itself — the actual otp_verified_at timestamp is
// recorded on the mou_signatures row at /confirm time, right alongside
// the signature, so the audit trail reads as one atomic "here is proof
// this person verified AND signed" rather than two separately-timed
// events that a gap between them could cast doubt on. This route's job
// is only to gate the client from proceeding to the signature step.

import { NextRequest, NextResponse } from 'next/server';
import { resolveSignToken } from '@/lib/mou/tokens';
import { checkOtp } from '@/lib/mou/otp';
import { simpleRateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { request: signRequest, error } = await resolveSignToken(token);

  if (error || !signRequest) {
    return NextResponse.json({ error: error ?? 'not_found' }, { status: 404 });
  }

  const rl = await simpleRateLimit(`mou:otp:verify:${signRequest.id}`, 10, 10 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'ลองใหม่เกินจำนวนที่กำหนด กรุณาลองใหม่ภายหลัง' }, { status: 429 });
  }

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.code || !/^\d{6}$/.test(body.code.trim())) {
    return NextResponse.json({ error: 'invalid_code_format' }, { status: 400 });
  }

  const result = await checkOtp({ signRequestId: signRequest.id, code: body.code });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
