// src/lib/mou/otp.ts
//
// OTP issue/verify for the MOU signing flow. SMS is stubbed behind the
// same interface as email (see sendOtpSms below) — this codebase has no
// SMS provider wired up anywhere yet (grepped: no Twilio/Vonage/AWS SNS
// references), so `channel: 'sms'` throws a clear "not configured" error
// today rather than silently pretending to send. Wire a real provider
// into sendOtpSms() when one is chosen; nothing else in this flow needs
// to change.

import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LENGTH = 6;

function generateCode(): string {
  // Cryptographically random digit string, not Math.random() — this
  // gates a legally-binding signature, same bar as a payment OTP.
  const max = 10 ** OTP_LENGTH;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(OTP_LENGTH, '0');
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

async function sendOtpEmail(to: string, code: string, organizationName: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MOU_NOTIFY_EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY or MOU_NOTIFY_EMAIL_FROM is not configured');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `รหัสยืนยัน (OTP) สำหรับลงนาม MOU — WOS`,
      text: [
        `รหัสยืนยันของคุณคือ: ${code}`,
        ``,
        `ใช้สำหรับยืนยันการลงนามข้อตกลง WOS Founding Partner Program (${organizationName})`,
        `รหัสนี้หมดอายุใน ${OTP_TTL_MINUTES} นาที และใช้ได้ครั้งเดียว`,
        ``,
        `หากคุณไม่ได้ร้องขอรหัสนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้`,
      ].join('\n'),
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#0b1e3d">รหัสยืนยันการลงนาม MOU</h2>
          <p style="color:#6b6a63">WOS Founding Partner Program — ${escapeHtml(organizationName)}</p>
          <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0b1e3d;margin:24px 0">${code}</p>
          <p style="color:#6b6a63;font-size:13px">รหัสนี้หมดอายุใน ${OTP_TTL_MINUTES} นาที และใช้ได้ครั้งเดียว หากคุณไม่ได้ร้องขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
        </div>
      `.trim(),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<failed to read response body>');
    throw new Error(`Resend sendEmail responded ${res.status}: ${body}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function sendOtpSms(to: string, code: string): Promise<void> {
  throw new Error(
    'SMS OTP is not configured — no SMS provider is wired into this codebase yet. ' +
      'Use channel "email", or add a provider in src/lib/mou/otp.ts:sendOtpSms().'
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type OtpChannel = 'email' | 'sms';

/**
 * Generates a fresh code, stores its hash, and sends it. Any
 * still-unconsumed earlier codes for this sign request are left alone
 * (they'll just fail the "most recent code" check in verifyOtp below) —
 * no need to invalidate them explicitly.
 */
export async function requestOtp(params: {
  signRequestId: string;
  channel: OtpChannel;
  destination: string;
  organizationName: string;
}): Promise<void> {
  const { signRequestId, channel, destination, organizationName } = params;
  const supabase = createServiceClient();

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  const { error: insertError } = await supabase.from('mou_otp_codes').insert({
    sign_request_id: signRequestId,
    channel,
    destination,
    code_hash: hashCode(code),
    expires_at: expiresAt,
    max_attempts: OTP_MAX_ATTEMPTS,
  });

  if (insertError) {
    throw new Error(`Failed to store OTP: ${insertError.message}`);
  }

  if (channel === 'email') {
    await sendOtpEmail(destination, code, organizationName);
  } else {
    await sendOtpSms(destination, code);
  }
}

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: 'no_active_code' | 'expired' | 'too_many_attempts' | 'incorrect' };

/**
 * Shared matcher. `consume: false` is used by the /otp/verify route as a
 * non-destructive UX pre-check (so the signing page can show a green
 * check mark and move the signer on to the signature pad); `consume:
 * true` is used ONLY by the /confirm route, which re-collects the code
 * alongside the signature and is the actual security boundary — the
 * earlier non-consuming check is a courtesy, not something the server
 * trusts on its own. This deliberately means the signer types the code
 * once but it gets checked (cheaply) up to twice; that's the cost of not
 * having a separate "verified but not yet consumed" state that a client
 * could replay or spoof.
 *
 * Wrong guesses always increment `attempts` regardless of `consume`, so
 * the non-consuming preview check still counts toward the brute-force
 * lockout.
 */
async function matchOtp(
  signRequestId: string,
  code: string,
  { consume }: { consume: boolean }
): Promise<VerifyOtpResult> {
  const supabase = createServiceClient();

  const { data: row, error } = await supabase
    .from('mou_otp_codes')
    .select('id, code_hash, expires_at, attempts, max_attempts, consumed_at')
    .eq('sign_request_id', signRequestId)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, reason: 'no_active_code' };
  }

  if (row.attempts >= row.max_attempts) {
    return { ok: false, reason: 'too_many_attempts' };
  }

  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, reason: 'expired' };
  }

  const providedHash = hashCode(code.trim());
  const matches =
    providedHash.length === row.code_hash.length &&
    crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(row.code_hash));

  if (!matches) {
    await supabase
      .from('mou_otp_codes')
      .update({ attempts: row.attempts + 1 })
      .eq('id', row.id);
    return { ok: false, reason: 'incorrect' };
  }

  if (consume) {
    await supabase.from('mou_otp_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id);
  }

  return { ok: true };
}

/** Non-consuming pre-check — see matchOtp's doc comment. */
export async function checkOtp(params: { signRequestId: string; code: string }): Promise<VerifyOtpResult> {
  return matchOtp(params.signRequestId, params.code, { consume: false });
}

/** Consuming check — the real gate, called from the /confirm route. */
export async function consumeOtp(params: { signRequestId: string; code: string }): Promise<VerifyOtpResult> {
  return matchOtp(params.signRequestId, params.code, { consume: true });
}
