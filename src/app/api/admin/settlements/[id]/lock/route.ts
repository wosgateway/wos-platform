// src/app/api/admin/settlements/[id]/lock/route.ts
//
// POST /api/admin/settlements/:id/lock
// PAID -> LOCKED, via lock_settlement() (sql/107). Terminal — there is
// no unlock route, on purpose (see 107's header: LOCKED is the
// permanent financial record).
//
// See approve/route.ts and src/lib/admin/settlement-transitions.ts —
// same shape, different RPC + audit action.

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';
import { runSettlementTransition, notifySettlementTransition } from '@/lib/admin/settlement-transitions';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();
  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  const settlementId = params.id;
  const supabase = createServiceClient();

  const result = await runSettlementTransition(supabase, 'lock_settlement', settlementId, auth.user.id);

  if (!result.ok) {
    return withRefreshedCookies(NextResponse.json({ error: result.error }, { status: result.status }), cookieCarrier);
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'settlement.lock',
    entityType: 'settlement',
    entityId: settlementId,
    after: result.data,
  });

  // Best-effort LINE push to the partner — not awaited, must never
  // delay or fail this response. See settlement-transitions.ts.
  void notifySettlementTransition(supabase, 'lock_settlement', settlementId, result);

  return withRefreshedCookies(NextResponse.json({ success: true, ...result.data }), cookieCarrier);
}
