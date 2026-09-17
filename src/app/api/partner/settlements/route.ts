// src/app/api/partner/settlements/route.ts
//
// GET /api/partner/settlements?status=&page=
//
// Phase 6 (Partner Portal) of the Settlement Engine build. Read-only
// mirror of /api/admin/settlements/route.ts (Phase 3), but scoped to
// the CALLING partner instead of accepting a partnerId query param —
// a partner has no business seeing another partner's settlements, so
// unlike the admin route there is no partnerId filter to abuse.
//
// Uses the service-role client, not the cookie-bound one — same
// reasoning as src/lib/partner/orders.ts: settlements/settlement_items
// have RLS enabled with NO client policies at all (105's header:
// "Settlement financial data is service-role/admin controlled"), so a
// session-bound client would always get zero rows back regardless of
// ownership. Ownership is enforced here in application code instead,
// via user.branch?.partner_id — the same field
// /api/partner/orders/route.ts keys off of.
//
// No approve/pay/lock here or anywhere else under /api/partner — a
// partner can only ever read their own settlements. Transitions stay
// admin-only (Phase 2 / sql/107's header).

import { NextResponse } from 'next/server';

import { getPartnerSession } from '@/lib/partner/auth';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const VALID_STATUSES = ['CALCULATED', 'APPROVED', 'PAID', 'LOCKED'] as const;

interface SettlementRow {
  id: string;
  partner_id: string;
  period_start: string;
  period_end: string;
  total_commission_due: number;
  item_count: number;
  status: string;
  approved_at: string | null;
  paid_at: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(request: Request) {
  const cookieCarrier = new NextResponse();
  const { user } = await getPartnerSession(cookieCarrier);

  if (!user) {
    return withRefreshedCookies(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookieCarrier);
  }

  const partnerId = user.branch?.partner_id ?? null;
  if (!partnerId) {
    // Same "user not linked to a branch/partner yet" case
    // /api/partner/orders/route.ts handles — empty list, not an error.
    return withRefreshedCookies(
      NextResponse.json({ rows: [], page: 0, pageSize: PAGE_SIZE, total: 0 }),
      cookieCarrier
    );
  }

  const url = new URL(request.url);
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const statusParam = url.searchParams.get('status')?.trim().toUpperCase();

  if (statusParam && !VALID_STATUSES.includes(statusParam as (typeof VALID_STATUSES)[number])) {
    return withRefreshedCookies(
      NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` }, { status: 400 }),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  let query = supabase
    .from('settlements')
    .select(
      'id, partner_id, period_start, period_end, total_commission_due, item_count, status, approved_at, paid_at, locked_at, created_at, updated_at',
      { count: 'exact' }
    )
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (statusParam) query = query.eq('status', statusParam);

  const { data, error, count } = await query;

  if (error) {
    console.error('fetch partner settlements failed:', error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load settlements: ' + error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  return withRefreshedCookies(
    NextResponse.json({ rows: (data ?? []) as SettlementRow[], page, pageSize: PAGE_SIZE, total: count ?? 0 }),
    cookieCarrier
  );
}
