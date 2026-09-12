// src/app/api/admin/notifications/summary/route.ts
//
// Backs the blinking notification bell in the admin nav (AdminGate.tsx
// -> NewActivityAlert.tsx). Polled client-side every ~15s.
//
// WHY POLLING, NOT SUPABASE REALTIME:
// `orders` has RLS "for all using (false)" — deny-by-default, admin
// access only through service-role API routes (see the comment on
// GET /api/trips and the same pattern on the trips table). That means
// an admin's browser session (authenticated, not service-role) can't
// SELECT `orders` directly, so a client-side `.channel().on('postgres_changes')`
// subscription for it would never fire — Realtime enforces the same
// RLS as a normal query. `partner_applications` DOES have an
// is_platform_admin() SELECT policy (030_partner_applications.sql) and
// could support realtime, but this route covers both counters the same
// way — one mechanism, no schema changes, and it works uniformly for
// any future counter added here without needing a new RLS policy per
// table.
//
// WHAT COUNTS AS "NEW":
// Purely relative to whatever `since_orders` / `since_leads` the caller
// passes (client's locally-stored "last seen" cursor) — this route has
// no opinion about backlog. A brand-new admin device with no stored
// cursor should pass no `since_*` param and get newCount: 0 back (see
// NewActivityAlert.tsx: first load seeds the cursor to `latestCreatedAt`
// without alarming on pre-existing rows; only arrivals after that point
// count as "new").
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';

interface CounterResult {
  latestCreatedAt: string | null;
  newCount: number;
}

async function getCounter(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  since: string | null,
  eqFilter?: { column: string; value: string }
): Promise<CounterResult> {
  let latestQuery = supabase.from(table).select('created_at').order('created_at', { ascending: false }).limit(1);
  if (eqFilter) latestQuery = latestQuery.eq(eqFilter.column, eqFilter.value);
  const { data: latest } = await latestQuery.maybeSingle();

  let newCount = 0;
  if (since) {
    let countQuery = supabase.from(table).select('id', { count: 'exact', head: true }).gt('created_at', since);
    if (eqFilter) countQuery = countQuery.eq(eqFilter.column, eqFilter.value);
    const { count } = await countQuery;
    newCount = count ?? 0;
  }

  return { latestCreatedAt: latest?.created_at ?? null, newCount };
}

export async function GET(req: NextRequest) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  // Polled every ~15s per admin session — generous but still a backstop
  // against a runaway client (stuck tab, buggy interval, etc).
  const rateLimit = await simpleRateLimit(`admin-notifications-summary:${auth.user.id}`, 120, 60 * 1000);
  if (!rateLimit.allowed) {
    return withRefreshedCookies(NextResponse.json({ error: 'rate_limited' }, { status: 429 }), cookieCarrier);
  }

  const { searchParams } = new URL(req.url);
  const sinceOrders = searchParams.get('since_orders');
  const sinceLeads = searchParams.get('since_leads');

  const supabase = createServiceClient();

  const [orders, leads] = await Promise.all([
    getCounter(supabase, 'orders', sinceOrders),
    // Only PENDING leads are "new" in the sense an admin needs to act on —
    // one already reviewed (APPROVED/REJECTED/etc.) shouldn't re-trigger
    // the bell just because its created_at happens to be recent.
    getCounter(supabase, 'partner_applications', sinceLeads, { column: 'status', value: 'PENDING' }),
  ]);

  return withRefreshedCookies(NextResponse.json({ orders, leads }), cookieCarrier);
}
