// src/app/api/admin/settlements/route.ts
//
// GET /api/admin/settlements?status=&partnerId=&page=
//
// Phase 3 (List/Detail) of the Settlement Engine build. Read-only —
// nothing here mutates a settlement; that's the calculate/approve/pay/
// lock routes (Phase 2). Same pagination shape as
// /api/admin/audit-log/route.ts (page/pageSize/total via Postgres
// `count: 'exact'`), since this is the same kind of admin-facing,
// potentially-long, filterable table.
//
// Partner name is resolved with a second query rather than a nested
// PostgREST select (settlements -> partners) — same reasoning as
// order-items/pending/route.ts: the FK constraint name Supabase
// auto-generates isn't asserted anywhere else in this codebase, so a
// guessed embed name is one schema-introspection surprise away from
// breaking silently. Two plain queries can't do that.

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
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
  created_by: string | null;
  approved_by: string | null;
  paid_by: string | null;
  locked_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PartnerRow {
  id: string;
  name: string;
}

export async function GET(request: Request) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  const url = new URL(request.url);
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const statusParam = url.searchParams.get('status')?.trim().toUpperCase();
  const partnerId = url.searchParams.get('partnerId')?.trim();

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
      'id, partner_id, period_start, period_end, total_commission_due, item_count, status, created_by, approved_by, paid_by, locked_by, approved_at, paid_at, locked_at, created_at, updated_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (statusParam) query = query.eq('status', statusParam);
  if (partnerId) query = query.eq('partner_id', partnerId);

  const { data, error, count } = await query;

  if (error) {
    console.error('fetch settlements failed:', error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load settlements: ' + error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  const rows = (data ?? []) as SettlementRow[];
  if (rows.length === 0) {
    return withRefreshedCookies(
      NextResponse.json({ rows: [], page, pageSize: PAGE_SIZE, total: count ?? 0 }),
      cookieCarrier
    );
  }

  const partnerIds = [...new Set(rows.map((r) => r.partner_id))];
  const { data: partners, error: partnersErr } = await supabase
    .from('partners')
    .select('id, name')
    .in('id', partnerIds);

  if (partnersErr) {
    console.error('fetch partners for settlements failed:', partnersErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load partners: ' + partnersErr.message }, { status: 500 }),
      cookieCarrier
    );
  }

  const partnerById = new Map((partners as PartnerRow[] | null ?? []).map((p) => [p.id, p]));

  const enriched = rows.map((row) => ({
    ...row,
    partner: partnerById.get(row.partner_id) ?? null,
  }));

  return withRefreshedCookies(
    NextResponse.json({ rows: enriched, page, pageSize: PAGE_SIZE, total: count ?? 0 }),
    cookieCarrier
  );
}
