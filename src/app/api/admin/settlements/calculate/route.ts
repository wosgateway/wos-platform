// src/app/api/admin/settlements/calculate/route.ts
//
// POST /api/admin/settlements/calculate
// Body: { partnerId: string, periodStart: "YYYY-MM-DD", periodEnd: "YYYY-MM-DD" }
//
// Phase 2 of the Settlement Engine build (105 = schema, 107 = RPCs,
// this = the write path admins actually call). Everything that makes
// this safe to run concurrently — the FOR UPDATE lock on the partner
// row, the eligible-items SELECT + INSERT happening in one
// transaction, the rollback-if-nothing-eligible behavior — lives in
// calculate_settlement() (sql/107). This route does exactly three
// things the RPC deliberately can't: authenticate the caller, turn
// its named exceptions into the right HTTP status + a message an
// admin can act on, and write the audit_log row (RPC has no reliable
// way to confirm p_admin_id is who it claims to be — requireAdmin()
// is what actually verified that; see 107's header).

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const cookieCarrier = new NextResponse();
  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  let body: { partnerId?: unknown; periodStart?: unknown; periodEnd?: unknown };
  try {
    body = await request.json();
  } catch {
    return withRefreshedCookies(NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }), cookieCarrier);
  }

  const { partnerId, periodStart, periodEnd } = body;

  // Shape validation here is purely for a fast, specific 400 — the RPC
  // re-validates period_start/period_end itself (invalid_period) and
  // would 500 on a malformed UUID, neither of which is a useful
  // response for what's almost always a frontend bug, not an admin
  // decision worth a 409/404.
  if (typeof partnerId !== 'string' || partnerId.trim() === '') {
    return withRefreshedCookies(NextResponse.json({ error: 'partnerId is required' }, { status: 400 }), cookieCarrier);
  }
  if (typeof periodStart !== 'string' || !DATE_RE.test(periodStart)) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'periodStart is required and must be YYYY-MM-DD' }, { status: 400 }),
      cookieCarrier
    );
  }
  if (typeof periodEnd !== 'string' || !DATE_RE.test(periodEnd)) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'periodEnd is required and must be YYYY-MM-DD' }, { status: 400 }),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  // Fetched purely so the audit_log row (and a 404 body) can name the
  // partner — never trusted as authorization or as an eligibility
  // check. calculate_settlement() re-locks and re-derives everything
  // itself from partnerId alone (see 107's header).
  const { data: partnerPreview } = await supabase
    .from('partners')
    .select('id, name')
    .eq('id', partnerId)
    .maybeSingle();

  const { data, error } = await supabase.rpc('calculate_settlement', {
    p_partner_id: partnerId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_admin_id: auth.user.id,
  });

  if (error) {
    const message = error.message ?? '';

    if (message.includes('invalid_period')) {
      return withRefreshedCookies(
        NextResponse.json({ error: 'periodEnd must be on or after periodStart' }, { status: 400 }),
        cookieCarrier
      );
    }
    if (message.includes('partner_not_found')) {
      return withRefreshedCookies(NextResponse.json({ error: 'Partner not found' }, { status: 404 }), cookieCarrier);
    }
    if (message.includes('no_eligible_items')) {
      // Well-formed request, nothing wrong with the partner or the
      // period — there just isn't anything to settle (already settled,
      // or nothing completed yet). Not a state conflict (409), so 422.
      return withRefreshedCookies(
        NextResponse.json(
          { error: 'No unsettled completed order items for this partner in the given period' },
          { status: 422 }
        ),
        cookieCarrier
      );
    }

    console.error('calculate_settlement RPC failed', { partnerId, periodStart, periodEnd, error });
    return withRefreshedCookies(
      NextResponse.json({ error: 'Settlement calculation failed: ' + message }, { status: 500 }),
      cookieCarrier
    );
  }

  const result = data as { settlementId?: string } | null;

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'settlement.calculate',
    entityType: 'settlement',
    entityId: result?.settlementId ?? null,
    before: partnerPreview ? { partnerId: partnerPreview.id, partnerName: partnerPreview.name } : { partnerId },
    after: data,
    metadata: { periodStart, periodEnd },
  });

  return withRefreshedCookies(NextResponse.json({ success: true, ...data }), cookieCarrier);
}
