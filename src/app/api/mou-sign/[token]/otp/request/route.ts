// src/app/api/mou-sign/[token]/otp/request/route.ts
//
// POST: sends an OTP to the sign request's registered email (the ONLY
// channel enabled today — see src/lib/mou/otp.ts's header comment on
// SMS). The destination is never taken from the request body — always
// the email already on file for this sign request (set by the admin
// when the link was created) — so this endpoint can't be used to spam
// an arbitrary address chosen by whoever has the link.

import { NextRequest, NextResponse } from 'next/server';
import { resolveSignToken } from '@/lib/mou/tokens';
import { requestOtp } from '@/lib/mou/otp';
import { simpleRateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { request: signRequest, error } = await resolveSignToken(token);

  if (error || !signRequest) {
    return NextResponse.json({ error: error ?? 'not_found' }, { status: 404 });
  }

  if (!signRequest.signerEmail) {
    return NextResponse.json({ error: 'no_email_on_file' }, { status: 400 });
  }

  // Rate-limit per sign request (not per IP) — the signer may be on
  // mobile data that shares an IP with other users, and per-request is
  // the meaningful boundary here anyway (nobody legitimately needs more
  // than a few OTP sends for one signature).
  const rl = await simpleRateLimit(`mou:otp:request:${signRequest.id}`, 5, 10 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'ขอรหัสถี่เกินไป กรุณาลองใหม่ภายหลัง' }, { status: 429 });
  }

  try {
    await requestOtp({
      signRequestId: signRequest.id,
      channel: 'email',
      destination: signRequest.signerEmail,
      organizationName: signRequest.organizationName,
    });
  } catch (e) {
    // Logged server-side because the client only ever shows a generic
    // "ส่งรหัสไม่สำเร็จ" label (see MouSignForm.tsx's REQUEST_ERROR_LABEL
    // fallback) — `detail` below reaches the browser's Network tab, but
    // not the terminal, so without this line the real cause (missing
    // RESEND_API_KEY/MOU_NOTIFY_EMAIL_FROM, a non-2xx from Resend, or a
    // mou_otp_codes insert failure) was invisible in local dev unless
    // someone thought to open DevTools.
    console.error('mou-sign otp/request failed:', e);
    return NextResponse.json(
      { error: 'ส่งรหัสยืนยันไม่สำเร็จ', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, sentTo: maskEmail(signRequest.signerEmail) });
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}
