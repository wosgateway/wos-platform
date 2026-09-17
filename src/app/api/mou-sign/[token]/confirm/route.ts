// src/app/api/mou-sign/[token]/confirm/route.ts
//
// POST: the actual signing action. Order of operations matters here and
// is deliberate:
//
//   1. Resolve + re-check token status (still pending, not expired).
//   2. Re-consume the OTP code (see src/lib/mou/otp.ts's matchOtp doc
//      comment — this, not the earlier /otp/verify call, is the real
//      security boundary).
//   3. Stamp the signature onto the PDF template.
//   4. Upload the signed PDF to the private `mou-documents` bucket.
//   5. Insert the append-only mou_signatures row (the legal record).
//   6. Flip mou_sign_requests.status to 'signed'.
//   7. Email the signed PDF to the partner + wosgateway@gmail.com.
//
// Steps 3-6 all happen before step 7 — a failure to send the email
// afterwards must never mean "the signature didn't happen." Steps 4-6
// are also ordered so that if the DB insert (5) fails, we've merely
// orphaned a Storage object (cheap, cleanable later) rather than the
// much worse failure mode of a DB row pointing at a PDF that was never
// actually stored.

import { NextRequest, NextResponse } from 'next/server';
import { resolveSignToken } from '@/lib/mou/tokens';
import { consumeOtp } from '@/lib/mou/otp';
import { stampSignatureOntoMou, loadMouBaseDocument } from '@/lib/mou/pdf';
import { sendSignedMouEmail } from '@/lib/mou/notify';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';

// loadMouBaseDocument() reads the on-disk template (fs/promises) or
// downloads the generated draft from Supabase Storage — needs the
// Node.js runtime, not Edge.
export const runtime = 'nodejs';

interface ConfirmBody {
  code: string; // OTP, re-submitted here — see file header
  signatureImagePngBase64: string; // data URL or raw base64, no prefix required
  signerName?: string; // pre-filled from the sign request but editable, e.g. mixed-case
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { request: signRequest, error: resolveError } = await resolveSignToken(token);

  if (resolveError || !signRequest) {
    return NextResponse.json({ error: resolveError ?? 'not_found' }, { status: 404 });
  }

  const rl = await simpleRateLimit(`mou:confirm:${signRequest.id}`, 5, 10 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'ลองใหม่เกินจำนวนที่กำหนด กรุณาลองใหม่ภายหลัง' }, { status: 429 });
  }

  let body: ConfirmBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.code || !/^\d{6}$/.test(body.code.trim())) {
    return NextResponse.json({ error: 'invalid_code_format' }, { status: 400 });
  }
  if (!body.signatureImagePngBase64) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 });
  }

  const otpResult = await consumeOtp({ signRequestId: signRequest.id, code: body.code });
  if (!otpResult.ok) {
    return NextResponse.json({ error: otpResult.reason }, { status: 400 });
  }

  // Strip a data URL prefix if the canvas component sent one
  // ("data:image/png;base64,...") rather than raw base64.
  const base64Payload = body.signatureImagePngBase64.replace(/^data:image\/png;base64,/, '');
  let signatureBuffer: Buffer;
  try {
    signatureBuffer = Buffer.from(base64Payload, 'base64');
    if (signatureBuffer.length === 0 || signatureBuffer.length > 2 * 1024 * 1024) {
      throw new Error('signature image is empty or too large');
    }
  } catch {
    return NextResponse.json({ error: 'invalid_signature_image' }, { status: 400 });
  }

  const signedAtIso = new Date().toISOString();
  const signerIp = getClientIp(req);
  const signerName = (body.signerName || signRequest.signerName).trim();

  let stamped: { pdfBytes: Uint8Array; sha256: string };
  try {
    // The exact bytes the signer read (their generated draft with
    // this org's name + rate filled in, or the blank template for
    // legacy pre-111 requests) — never re-derive from templateVersion
    // directly here, or a dynamic draft and its stamped signature
    // could silently diverge.
    const baseDocumentBytes = await loadMouBaseDocument({
      templateVersion: signRequest.templateVersion,
      draftStoragePath: signRequest.draftStoragePath,
    });
    stamped = await stampSignatureOntoMou({
      baseDocumentBytes,
      signatureImagePng: signatureBuffer,
      signerName,
      signedAtIso,
      signerIp,
      verificationMethod: 'email_otp',
      organizationName: signRequest.organizationName,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'สร้างเอกสารลงนามไม่สำเร็จ', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  const supabase = createServiceClient();
  const storagePath = `signed/${signRequest.organizationId}/${signRequest.id}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from('mou-documents')
    .upload(storagePath, Buffer.from(stamped.pdfBytes), {
      contentType: 'application/pdf',
      upsert: false, // one signature per request — see mou_signatures' unique index
    });

  if (uploadError) {
    return NextResponse.json({ error: 'บันทึกเอกสารไม่สำเร็จ', detail: uploadError.message }, { status: 500 });
  }

  const { error: insertError } = await supabase.from('mou_signatures').insert({
    sign_request_id: signRequest.id,
    organization_id: signRequest.organizationId,
    signed_at: signedAtIso,
    signer_name: signerName,
    signer_email: signRequest.signerEmail,
    signer_phone: signRequest.signerPhone,
    signer_ip: signerIp,
    signer_user_agent: req.headers.get('user-agent'),
    verification_method: 'email_otp',
    otp_verified_at: signedAtIso,
    document_storage_path: storagePath,
    document_sha256: stamped.sha256,
  });

  if (insertError) {
    // The PDF is already in Storage but the audit row failed — surface
    // this loudly rather than silently telling the signer it worked.
    // The unique index on sign_request_id means a legitimate retry
    // after fixing whatever caused this will fail with a clean
    // "already exists" rather than double-writing, so it's safe to ask
    // the signer to try again.
    return NextResponse.json(
      { error: 'บันทึกข้อมูลการลงนามไม่สำเร็จ กรุณาลองใหม่', detail: insertError.message },
      { status: 500 }
    );
  }

  await supabase
    .from('mou_sign_requests')
    .update({ status: 'signed', updated_at: signedAtIso })
    .eq('id', signRequest.id);

  try {
    await sendSignedMouEmail({
      organizationName: signRequest.organizationName,
      signerName,
      signerEmail: signRequest.signerEmail,
      pdfBytes: stamped.pdfBytes,
      fileName: `WOS-MOU-${signRequest.organizationName}.pdf`.replace(/\s+/g, '-'),
    });
  } catch (e) {
    // Signature is legally recorded regardless (mou_signatures row +
    // Storage object both already committed above) — only the courtesy
    // email failed. Tell the signer their signature succeeded, but flag
    // the delivery problem so an admin can resend from the PDF now
    // sitting in Storage.
    return NextResponse.json({
      ok: true,
      emailWarning: 'ลงนามสำเร็จ แต่ส่งอีเมลเอกสารไม่สำเร็จ ทีมงาน WOS จะติดต่อกลับพร้อมเอกสาร',
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({ ok: true });
}
