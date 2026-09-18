// src/lib/mou/create-sign-request.ts
//
// Extracted from src/app/api/admin/mou/create-sign-request/route.ts
// unchanged in behaviour — the route now calls this and does nothing
// else but auth, validation and audit logging.
//
// The extraction exists because resend/route.ts needs the exact same
// sequence (resolve rate -> freeze snapshot -> insert row -> generate
// the per-partner draft PDF -> upload -> email). Copying ~120 lines
// of that into a second route would mean two places that can drift on
// a detail like "delete the row if the draft fails" — the one step
// that stops a partner being emailed a link to a document that
// doesn't exist.
//
// Deliberately NOT exported as a route handler: it returns a result
// object rather than a NextResponse, so callers decide their own
// status codes (create/ returns 207 on email failure, resend/ has to
// also report what it cancelled).

import { createServiceClient } from '@/lib/supabase/service';
import { generateSignToken, SIGN_LINK_TTL_DAYS } from '@/lib/mou/tokens';
import { fillMouDraft } from '@/lib/mou/pdf';
import { resolveCommercialFeeRateForOrganization } from '@/lib/mou/commercial-terms';

// 2026-09 fix: was NEXT_PUBLIC_APP_URL, a second env var that was never
// actually set in Vercel (only NEXT_PUBLIC_SITE_URL was, for the partner
// invite-link routes — see provision/resend-invite-link/portal-access
// route.ts). That meant every MOU sign-link silently fell back to
// localhost:3001 in production, same failure mode as the partner-invite
// bug, just a second unset variable causing it. Reusing
// NEXT_PUBLIC_SITE_URL keeps one canonical site URL for both link kinds
// instead of two env vars that can drift out of sync.
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';

export const DEFAULT_TEMPLATE_VERSION = 'founding-partner-v1';

export interface CreateMouSignRequestParams {
  organizationId: string;
  signerName: string;
  signerEmail: string;
  templateVersion?: string;
  createdBy: string;
}

export type CreateMouSignRequestResult =
  | { ok: true; signRequestId: string; link: string; emailSent: true }
  // Row + draft exist and the link works; only delivery failed. The
  // caller must surface `link` so the admin can send it by hand.
  | { ok: true; signRequestId: string; link: string; emailSent: false; sendError: string }
  | { ok: false; error: string; detail?: string; status: number };

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      subject: 'เชิญลงนามข้อตกลง WOS Founding Partner Program',
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

export async function createMouSignRequest(
  params: CreateMouSignRequestParams
): Promise<CreateMouSignRequestResult> {
  const { organizationId, signerName, signerEmail, createdBy } = params;
  const templateVersion = params.templateVersion || DEFAULT_TEMPLATE_VERSION;
  const supabase = createServiceClient();

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', organizationId)
    .maybeSingle();

  if (orgError || !org) {
    return { ok: false, error: 'ไม่พบพันธมิตรรายนี้', status: 404 };
  }

  // Resolved + frozen BEFORE the insert so the row's snapshot and the
  // % actually drawn onto the draft PDF can never disagree (111).
  const commercialFeeRate = await resolveCommercialFeeRateForOrganization(organizationId);

  const { token, tokenHash } = generateSignToken();
  const tokenExpiresAt = new Date(Date.now() + SIGN_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: signRequest, error: insertError } = await supabase
    .from('mou_sign_requests')
    .insert({
      organization_id: organizationId,
      template_version: templateVersion,
      commercial_fee_rate_snapshot: commercialFeeRate,
      signer_name: signerName.trim(),
      signer_email: signerEmail.trim(),
      delivery_channel: 'email',
      token_hash: tokenHash,
      token_expires_at: tokenExpiresAt,
      created_by: createdBy,
    })
    .select('id')
    .single();

  if (insertError || !signRequest) {
    return { ok: false, error: 'สร้างคำขอลงนามไม่สำเร็จ', detail: insertError?.message, status: 500 };
  }

  // Draft BEFORE any email — a signer must never receive a link that
  // resolves to a missing document. Roll the row back if this fails
  // rather than leaving a dead link nobody notices.
  const draftStoragePath = `drafts/${organizationId}/${signRequest.id}.pdf`;
  try {
    const draft = await fillMouDraft({
      templateVersion,
      organizationName: org.name,
      commercialFeeRatePercent: commercialFeeRate,
    });
    const { error: uploadError } = await supabase.storage
      .from('mou-documents')
      .upload(draftStoragePath, Buffer.from(draft.pdfBytes), {
        contentType: 'application/pdf',
        upsert: false, // path keyed by this row's fresh id — never a collision
      });
    if (uploadError) throw new Error(uploadError.message);

    await supabase
      .from('mou_sign_requests')
      .update({ draft_storage_path: draftStoragePath })
      .eq('id', signRequest.id);
  } catch (e) {
    await supabase.from('mou_sign_requests').delete().eq('id', signRequest.id);
    return {
      ok: false,
      error:
        'สร้างเอกสารร่าง MOU ไม่สำเร็จ กรุณาตรวจสอบว่าวางไฟล์ template ไว้ถูกที่ (legal/mou-templates/) แล้วลองใหม่',
      detail: e instanceof Error ? e.message : String(e),
      status: 500,
    };
  }

  const link = `${APP_URL}/partner/mou-sign/${token}`;

  try {
    await sendSignLinkEmail(signerEmail.trim(), signerName.trim(), org.name, link);
    // invite_email_status exists since 100 and was never actually
    // written by the original route — only sent_at was. Both are set
    // here so the delivery-failure columns 100 added are usable.
    await supabase
      .from('mou_sign_requests')
      .update({ sent_at: new Date().toISOString(), invite_email_status: 'sent', invite_email_error: null })
      .eq('id', signRequest.id);
    return { ok: true, signRequestId: signRequest.id, link, emailSent: true };
  } catch (e) {
    const sendError = e instanceof Error ? e.message : String(e);
    await supabase
      .from('mou_sign_requests')
      .update({ invite_email_status: 'failed', invite_email_error: sendError })
      .eq('id', signRequest.id);
    return { ok: true, signRequestId: signRequest.id, link, emailSent: false, sendError };
  }
}
