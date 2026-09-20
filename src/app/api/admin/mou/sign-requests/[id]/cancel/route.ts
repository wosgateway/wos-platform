// src/app/api/admin/mou/sign-requests/[id]/cancel/route.ts
//
// POST — invalidate a sent-but-unsigned MOU link (wrong signer, the
// contact left the clinic, terms renegotiated before signing).
// `cancelled` has been a legal status since 099 with nothing able to
// write it; this is that missing write.
//
// All the real logic is in cancel_mou_sign_request() (114) because
// the status precondition has to be part of the UPDATE, not a
// separate SELECT — a request can be signed between the two, and
// cancelling a request that already carries a real signature would
// mean the audit trail contradicts a document someone actually
// signed. The function's compare-and-swap makes that unreachable.
//
// No email is sent on cancel. The old link simply stops resolving
// (resolveSignToken checks status). Telling a partner "ignore the
// email we sent you" is a human decision with wording an admin
// should choose, not an automatic message — and /resend covers the
// common case, where the replacement invitation is the message.

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface CancelBody {
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

  const { id } = await params;

  let body: CancelBody = {};
  try {
    body = await req.json();
  } catch {
    // Reason is optional — an empty body is a valid cancel.
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('cancel_mou_sign_request', {
    p_sign_request_id: id,
    p_cancelled_by: auth.user.id,
    p_reason: body.reason ?? null,
  });

  if (error) {
    // WS004 / WS005 are raised by the function itself (114) and are
    // expected admin-facing outcomes, not server faults — map them to
    // 404/409 with the Thai HINT the function already carries rather
    // than logging them as errors.
    const code = (error as { code?: string }).code;
    if (code === 'WS004') {
      return withRefreshedCookies(
        NextResponse.json({ error: 'ไม่พบคำขอลงนามนี้' }, { status: 404 }),
        cookieCarrier
      );
    }
    if (code === 'WS005') {
      return withRefreshedCookies(
        NextResponse.json(
          { error: (error as { hint?: string }).hint ?? 'คำขอนี้ยกเลิกไม่ได้', detail: error.message },
          { status: 409 }
        ),
        cookieCarrier
      );
    }
    console.error('mou cancel: rpc failed', error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'ยกเลิกคำขอลงนามไม่สำเร็จ', detail: error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  const row = Array.isArray(data) ? data[0] : data;

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'mou.sign_request.cancel',
    entityType: 'organization',
    entityId: row?.organization_id ?? null,
    metadata: { signRequestId: id, reason: body.reason ?? null },
  });

  return withRefreshedCookies(NextResponse.json({ ok: true, signRequest: row }), cookieCarrier);
}
