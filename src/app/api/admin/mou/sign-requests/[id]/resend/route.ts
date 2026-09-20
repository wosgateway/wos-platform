// src/app/api/admin/mou/sign-requests/[id]/resend/route.ts
//
// POST — replace an expired/unsigned MOU invitation with a fresh one.
// Covers the two cases an admin hits most: the 14-day link lapsed,
// or the email never arrived (invite_email_status = 'failed').
//
// CANCEL-THEN-CREATE, NOT REVIVE:
//   The obvious shortcut — push token_expires_at forward on the
//   existing row — is wrong. The raw token was shown exactly once at
//   creation (only token_hash is stored, 099), so there is no link
//   left to extend; extending the row would produce a live request
//   whose token nobody, including us, possesses. Re-minting the
//   token in place would instead mutate a record that an OTP may
//   already have been verified against. A new row is the only shape
//   that stays truthful, and superseded_by_id (114) is what keeps
//   the two readable as one chain.
//
// ORDER — cancel first, then create:
//   If creation fails after the cancel, the partner is left with no
//   live link, which is visible and recoverable (press resend
//   again). The reverse order can leave two simultaneously valid
//   links for the same MOU if the cancel then fails — two different
//   documents the partner could sign, one of which nobody is
//   watching. Fail toward zero live links, never toward two.
//
// The replacement can be addressed to a different signer (the common
// reason a link is dead is that the original contact left), which is
// why signerName/signerEmail are accepted and default to the old
// row's values rather than being forced.

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';
import { createMouSignRequest } from '@/lib/mou/create-sign-request';

// Goes through createMouSignRequest -> fillMouDraft (pdf-lib).
export const runtime = 'nodejs';

interface ResendBody {
  signerName?: string;
  signerEmail?: string;
  reason?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const fail = (message: string, status: number, extra?: Record<string, unknown>) =>
    withRefreshedCookies(NextResponse.json({ error: message, ...extra }, { status }), cookieCarrier);

  // Same budget as create — this route sends a real email to a real
  // partner and a double-click must not send two.
  const rl = await simpleRateLimit(`mou:resend:${auth.user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return fail('ลองใหม่อีกครั้งในอีกสักครู่', 429);
  }

  const { id } = await params;

  let body: ResendBody = {};
  try {
    body = await req.json();
  } catch {
    // All fields optional — an empty body means "same signer, same terms".
  }

  const supabase = createServiceClient();

  const { data: original, error: fetchErr } = await supabase
    .from('mou_sign_requests')
    .select('id, organization_id, status, signer_name, signer_email, template_version')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !original) {
    return fail('ไม่พบคำขอลงนามนี้', 404);
  }

  if (original.status === 'signed') {
    // Not a resend situation at all — there is a signature on file.
    // Re-inviting would invite a second signature for the same MOU,
    // which mou_signatures' unique index would reject anyway, one
    // wasted email later.
    return fail('พันธมิตรรายนี้ลงนามไปแล้ว — หากต้องการแก้ไขเงื่อนไข ต้องออก MOU ฉบับใหม่', 409);
  }

  const signerName = (body.signerName ?? original.signer_name ?? '').trim();
  const signerEmail = (body.signerEmail ?? original.signer_email ?? '').trim();

  if (!signerName || !signerEmail || !signerEmail.includes('@')) {
    return fail('ต้องระบุชื่อและอีเมลผู้ลงนามที่ถูกต้อง', 400);
  }

  // 1. Kill the old link first (see header). Already-cancelled /
  // already-expired rows are fine to skip — nothing live to revoke.
  if (original.status === 'pending' || original.status === 'otp_verified') {
    const { error: cancelErr } = await supabase.rpc('cancel_mou_sign_request', {
      p_sign_request_id: id,
      p_cancelled_by: auth.user.id,
      p_reason: body.reason?.trim() || 'ส่งลิงก์ลงนามใหม่แทนฉบับเดิม',
    });

    if (cancelErr) {
      const code = (cancelErr as { code?: string }).code;
      if (code === 'WS005') {
        // Raced with a signature completing between our SELECT and
        // this call — the right answer is still "don't resend".
        return fail('คำขอนี้เปลี่ยนสถานะระหว่างดำเนินการ (อาจลงนามสำเร็จไปแล้ว) กรุณารีเฟรชแล้วตรวจสอบ', 409);
      }
      console.error('mou resend: cancel step failed', cancelErr);
      return fail('ยกเลิกลิงก์เดิมไม่สำเร็จ จึงยังไม่ได้ส่งลิงก์ใหม่', 500, { detail: cancelErr.message });
    }
  }

  // 2. New request — fresh token, fresh 14-day TTL, and a freshly
  // resolved rate snapshot. Resolving the rate again is intentional:
  // if the commercial terms changed since the original invitation
  // (101 periods), the replacement draft must show the rate the
  // partner is actually being asked to agree to now, not the stale
  // one frozen onto the dead request.
  const result = await createMouSignRequest({
    organizationId: original.organization_id,
    signerName,
    signerEmail,
    templateVersion: original.template_version ?? undefined,
    createdBy: auth.user.id,
  });

  if (!result.ok) {
    // Old link is already dead at this point — say so explicitly so
    // the admin knows the partner currently has nothing to click and
    // that pressing resend again is the fix.
    return fail(result.error, result.status, {
      detail: result.detail,
      note: 'ลิงก์เดิมถูกยกเลิกแล้ว และยังสร้างลิงก์ใหม่ไม่สำเร็จ — กรุณากดส่งใหม่อีกครั้ง',
    });
  }

  // 3. Chain the two rows together. Best-effort: the invitation is
  // already out, and a missing back-reference is a reporting
  // annoyance, not a correctness problem worth failing the request
  // over (or worse, rolling back an email that has been delivered).
  const { error: linkErr } = await supabase
    .from('mou_sign_requests')
    .update({ superseded_by_id: result.signRequestId })
    .eq('id', id);
  if (linkErr) {
    console.error('mou resend: superseded_by_id link failed (invitation already sent)', linkErr);
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'mou.sign_request.resend',
    entityType: 'organization',
    entityId: original.organization_id,
    metadata: {
      previousSignRequestId: id,
      previousStatus: original.status,
      signRequestId: result.signRequestId,
      signerEmail,
      signerChanged: signerEmail !== (original.signer_email ?? ''),
      emailSent: result.emailSent,
    },
  });

  if (!result.emailSent) {
    return withRefreshedCookies(
      NextResponse.json(
        {
          warning: 'สร้างลิงก์ใหม่สำเร็จ แต่ส่งอีเมลไม่สำเร็จ — กรุณาคัดลอกลิงก์ไปส่งเอง',
          signRequestId: result.signRequestId,
          link: result.link,
          sendError: result.sendError,
        },
        { status: 207 }
      ),
      cookieCarrier
    );
  }

  return withRefreshedCookies(
    NextResponse.json({ ok: true, signRequestId: result.signRequestId, link: result.link }),
    cookieCarrier
  );
}
