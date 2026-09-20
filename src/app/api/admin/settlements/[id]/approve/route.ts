// src/app/api/admin/settlements/[id]/approve/route.ts
//
// POST /api/admin/settlements/:id/approve
// CALCULATED -> APPROVED, via approve_settlement() (sql/107).
//
// The atomic claim (only one concurrent "Approve" click can win) lives
// in the RPC. This route's job is auth, mapping the RPC's named
// exceptions to HTTP status, and the audit_log write — see
// src/lib/admin/settlement-transitions.ts for why that mapping is
// shared across approve/pay/lock instead of copy-pasted three times.

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

  const result = await runSettlementTransition(supabase, 'approve_settlement', settlementId, auth.user.id);

  if (!result.ok) {
    return withRefreshedCookies(NextResponse.json({ error: result.error }, { status: result.status }), cookieCarrier);
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'settlement.approve',
    entityType: 'settlement',
    entityId: settlementId,
    after: result.data,
  });

  // Best-effort LINE push to the partner — not awaited, must never
  // delay or fail this response. See settlement-transitions.ts.
  void notifySettlementTransition(supabase, 'approve_settlement', settlementId, result);

  return withRefreshedCookies(NextResponse.json({ success: true, ...result.data }), cookieCarrier);
}
