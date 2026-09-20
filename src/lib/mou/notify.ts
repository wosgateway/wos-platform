// src/lib/mou/notify.ts
//
// Emails the completed, signed MOU PDF to the partner and to the WOS
// admin inbox. Same Resend-via-fetch approach as
// src/lib/notify/consultation-notify.ts (no SDK dependency) — the only
// difference is this one attaches a file, which Resend's API takes as
// base64 in the `attachments` array.
//
// Unlike order-notify.ts/consultation-notify.ts, this send is NOT
// best-effort-and-ignore: the requirement is explicit that both the
// partner and wosgateway@gmail.com must receive the signed PDF, so the
// caller (the /confirm route) awaits this and surfaces a failure to the
// signer rather than silently losing the delivery. The signature row is
// still written to mou_signatures (the source of truth) before this
// runs, so a delivery failure never loses the legal record — only the
// convenience email, which the partner can be resent via
// GET /api/admin/mou/[signRequestId]/resend below (not included in this
// pass — see the README note in this PR).

const ADMIN_INBOX = 'wosgateway@gmail.com';

export interface SendSignedMouEmailParams {
  organizationName: string;
  signerName: string;
  signerEmail: string | null;
  pdfBytes: Uint8Array;
  fileName: string;
}

export async function sendSignedMouEmail(params: SendSignedMouEmailParams): Promise<void> {
  const { organizationName, signerName, signerEmail, pdfBytes, fileName } = params;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MOU_NOTIFY_EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY or MOU_NOTIFY_EMAIL_FROM is not configured');
  }

  const recipients = [ADMIN_INBOX, ...(signerEmail ? [signerEmail] : [])];
  const attachmentBase64 = Buffer.from(pdfBytes).toString('base64');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from,
      to: recipients,
      subject: `✅ MOU ลงนามเรียบร้อย — WOS Founding Partner (${organizationName})`,
      text: [
        `${organizationName} ได้ลงนามข้อตกลง WOS Founding Partner Program เรียบร้อยแล้ว`,
        ``,
        `ผู้ลงนาม: ${signerName}`,
        `เอกสารฉบับลงนามแนบมาพร้อมอีเมลนี้`,
      ].join('\n'),
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#0b1e3d">✅ MOU ลงนามเรียบร้อย</h2>
          <p style="color:#0b1e3d"><strong>${escapeHtml(organizationName)}</strong> ได้ลงนามข้อตกลง WOS Founding Partner Program เรียบร้อยแล้ว</p>
          <p style="color:#6b6a63">ผู้ลงนาม: ${escapeHtml(signerName)}</p>
          <p style="color:#6b6a63;font-size:13px">เอกสารฉบับลงนามแนบมาพร้อมอีเมลนี้</p>
        </div>
      `.trim(),
      attachments: [
        {
          filename: fileName,
          content: attachmentBase64,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend sendEmail (signed MOU) responded ${res.status}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
