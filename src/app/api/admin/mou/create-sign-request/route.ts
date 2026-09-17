// src/app/api/admin/mou/create-sign-request/route.ts
//
// Admin action: create a sign-link for a partner org and email it to
// them. Deliberately does NOT send via LINE in this first pass — the
// dev spec mentions "อีเมล หรือ LINE" but this repo's only outbound LINE
// integration (src/lib/notify/driver-line.ts, hotel-line.ts) pushes to a
// partner's `line_user_id` column on partners/drivers, which prospective
// Founding Partners signing their FIRST document with WOS typically
// don't have yet (no portal account = no LINE link established). Email
// covers the actual Founding Partner onboarding case; LINE delivery for
// already-onboarded partners is a straightforward follow-up using the
// same pattern as driver-line.ts, not included here to keep this route
// reviewable.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';
import { generateSignToken, SIGN_LINK_TTL_DAYS } from '@/lib/mou/tokens';
import { simpleRateLimit } from '@/lib/rate-limit';
import { fillMouDraft } from '@/lib/mou/pdf';
import { resolveCommercialFeeRateForOrganization } from '@/lib/mou/commercial-terms';

// pdf-lib (fillMouDraft) reads/writes real bytes — needs the Node.js
// runtime, not Edge. Same requirement as confirm/route.ts.
export const runtime = 'nodejs';

// Deliberately NOT a module-level constant read from
// process.env.NEXT_PUBLIC_APP_URL — that env var going unset in
// production (nothing here would have caught it) silently fell back
// to 'http://localhost:3001', so every sign-link ever emailed to a
// real partner pointed at the admin's own laptop instead of wos.asia.
// Derived per-request from req.url instead, same pattern already used
// by provision.ts's redirectTo and portal-access/route.ts's redirectTo
// — that's the actual Host the request came in on, so it's right in
// every environment (local, staging, prod) with zero config needed.

interface CreateSignRequestBody {
  organizationId: string;
  signerName: string;
  signerEmail: string;
  templateVersion?: string;
}

async function sendSignLinkEmail(to: string, signerName: string, organizationName: string, link: string) {
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
      subject: `เชิญลงนามข้อตกลง WOS Founding Partner Program`,
      text: [
        `เรียน คุณ${signerName} (${organizationName})`,
        ``,
        `WOS ขอเชิญท่านลงนามข้อตกลง WOS Founding Partner Program ผ่านระบบออนไลน์ (ไม่ต้องพิมพ์เอกสาร)`,
        ``,
        `ลิงก์สำหรับลงนาม: ${link}`,
        `ลิงก์นี้จะหมดอายุใน ${SIGN_LINK_TTL_DAYS} วัน`,
      ].join('\n'),
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#0b1e3d">เชิญลงนามข้อตกลง WOS Founding Partner Program</h2>
          <p style="color:#0b1e3d">เรียน คุณ${escapeHtml(signerName)} (${escapeHtml(organizationName)})</p>
          <p style="color:#6b6a63">กรุณาลงนามข้อตกลงผ่านระบบออนไลน์ — ไม่ต้องดาวน์โหลดหรือพิมพ์เอกสาร</p>
          <p style="margin-top:20px">
            <a href="${link}" style="background:#5b8c6e;color:#fff;padding:10px 20px;border-radius:24px;text-decoration:none;font-weight:600">
              ลงนามข้อตกลง
            </a>
          </p>
          <p style="color:#9a988f;font-size:12px">ลิงก์นี้จะหมดอายุใน ${SIGN_LINK_TTL_DAYS} วัน</p>
        </div>
      `.trim(),
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend sendEmail (sign link) responded ${res.status}`);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  const response = NextResponse.next();
  const auth = await requireAdmin(response);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const appUrl = new URL(req.url).origin;

  // One sign-link creation per admin per minute is plenty for normal
  // use and stops a fat-fingered double-submit from emailing a partner
  // twice, same rationale as other admin write routes in this repo.
  const rl = await simpleRateLimit(`mou:create-sign-request:${auth.user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'ลองใหม่อีกครั้งในอีกสักครู่' }, { status: 429 });
  }

  let body: CreateSignRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { organizationId, signerName, signerEmail, templateVersion } = body;
  if (!organizationId || !signerName?.trim() || !signerEmail?.trim()) {
    return NextResponse.json(
      { error: 'organizationId, signerName, signerEmail are required' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', organizationId)
    .maybeSingle();

  if (orgError || !org) {
    return NextResponse.json({ error: 'ไม่พบพันธมิตรรายนี้' }, { status: 404 });
  }

  // Resolved + frozen BEFORE the insert below, so the row's
  // commercial_fee_rate_snapshot and the % actually drawn onto the
  // draft PDF can never disagree — see 111's migration header.
  const commercialFeeRate = await resolveCommercialFeeRateForOrganization(organizationId);
  const resolvedTemplateVersion = templateVersion || 'founding-partner-v1';

  const { token, tokenHash } = generateSignToken();
  const tokenExpiresAt = new Date(Date.now() + SIGN_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: signRequest, error: insertError } = await supabase
    .from('mou_sign_requests')
    .insert({
      organization_id: organizationId,
      template_version: resolvedTemplateVersion,
      commercial_fee_rate_snapshot: commercialFeeRate,
      signer_name: signerName.trim(),
      signer_email: signerEmail.trim(),
      delivery_channel: 'email',
      token_hash: tokenHash,
      token_expires_at: tokenExpiresAt,
      created_by: auth.user.id,
    })
    .select('id')
    .single();

  if (insertError || !signRequest) {
    return NextResponse.json({ error: 'สร้างคำขอลงนามไม่สำเร็จ' }, { status: 500 });
  }

  // Generate the per-request draft (this partner's actual name + %)
  // and store it BEFORE emailing anything — a signer must never be
  // sent a link that resolves to a broken/missing document. If this
  // fails, roll back the row we just inserted rather than leaving a
  // dead link an admin might not notice failed.
  const draftStoragePath = `drafts/${organizationId}/${signRequest.id}.pdf`;
  try {
    const draft = await fillMouDraft({
      templateVersion: resolvedTemplateVersion,
      organizationName: org.name,
      commercialFeeRatePercent: commercialFeeRate,
    });
    const { error: uploadError } = await supabase.storage
      .from('mou-documents')
      .upload(draftStoragePath, Buffer.from(draft.pdfBytes), {
        contentType: 'application/pdf',
        upsert: false, // path is keyed by this row's freshly-generated id, so it's never a collision — same posture as confirm/route.ts's signed-doc upload
      });
    if (uploadError) throw new Error(uploadError.message);

    await supabase
      .from('mou_sign_requests')
      .update({ draft_storage_path: draftStoragePath })
      .eq('id', signRequest.id);
  } catch (e) {
    await supabase.from('mou_sign_requests').delete().eq('id', signRequest.id);
    return NextResponse.json(
      {
        error: 'สร้างเอกสารร่าง MOU ไม่สำเร็จ กรุณาตรวจสอบว่าวางไฟล์ template ไว้ถูกที่ (legal/mou-templates/) แล้วลองใหม่',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }

  const link = `${appUrl}/partner/mou-sign/${token}`;

  try {
    await sendSignLinkEmail(signerEmail.trim(), signerName.trim(), org.name, link);
    await supabase
      .from('mou_sign_requests')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', signRequest.id);
  } catch (e) {
    // The row exists either way — surface the send failure so the admin
    // knows to retry/resend, but don't roll back the sign request itself
    // (it's still a valid, usable link; only the email delivery failed).
    return NextResponse.json(
      {
        warning: 'สร้างลิงก์สำเร็จ แต่ส่งอีเมลไม่สำเร็จ — กรุณาคัดลอกลิงก์ไปส่งเอง',
        signRequestId: signRequest.id,
        link,
        sendError: e instanceof Error ? e.message : String(e),
      },
      { status: 207 }
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'mou.sign_request.create',
    entityType: 'organization',
    entityId: organizationId,
    metadata: { signRequestId: signRequest.id, signerEmail: signerEmail.trim() },
  });

  return NextResponse.json({ signRequestId: signRequest.id, link });
}
