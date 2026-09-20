// src/app/api/admin/promo-banners/reorder/route.ts
//
// Batch renumber of display_order after a drag-reorder in
// PromoBannersManager.tsx. Per 093_promo_banners.sql's header
// comment: display_order is a plain integer, not a fractional/
// lexicographic key, so a reorder is "PATCH every row with its new
// position" rather than a single-row insert-between operation — this
// route does that as one request instead of the client firing N
// individual PATCH /promo-banners/[id] calls.
//
// PostgREST/Supabase-js has no native "bulk update, different value
// per row" — .upsert() is the standard workaround (each row supplies
// its own id + display_order; unspecified columns are left alone
// only if `ignoreDuplicates` is false and the row already exists,
// which is the default), same technique used nowhere else yet in
// this repo but is the documented Supabase pattern for this exact
// case.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';

export async function PATCH(req: NextRequest) {
  const cookieCarrier = new NextResponse();
  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const body = await req.json().catch(() => null);
  const order = body?.order;
  if (!Array.isArray(order) || order.length === 0) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'missing_fields', detail: 'order must be a non-empty array of { id, display_order }' },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  for (const item of order) {
    if (typeof item?.id !== 'string' || typeof item?.display_order !== 'number') {
      return withRefreshedCookies(
        NextResponse.json(
          { error: 'invalid_item', detail: 'each item needs a string id and numeric display_order' },
          { status: 400 }
        ),
        cookieCarrier
      );
    }
  }

  const supabase = createServiceClient();

  // upsert() requires every NOT NULL column without a default to be
  // present or it'll try to insert a bad row on a (should-never-
  // happen) id mismatch — image_url/title have no meaningful value to
  // supply here, so fetch the current rows first and merge in just
  // the new display_order rather than upserting partial rows.
  const { data: existing, error: fetchErr } = await supabase
    .from('promo_banners')
    .select('*')
    .in('id', order.map((o: { id: string }) => o.id));

  if (fetchErr) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'fetch_failed', detail: fetchErr.message }, { status: 500 }),
      cookieCarrier
    );
  }

  const orderMap = new Map(order.map((o: { id: string; display_order: number }) => [o.id, o.display_order]));
  const rows = (existing ?? []).map((row) => ({
    ...row,
    display_order: orderMap.get(row.id) ?? row.display_order,
  }));

  const { data: updated, error } = await supabase
    .from('promo_banners')
    .upsert(rows)
    .select('*')
    .order('display_order', { ascending: true });

  if (error) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'reorder_failed', detail: error.message }, { status: 400 }),
      cookieCarrier
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'promo_banner.reorder',
    entityType: 'promo_banner',
    metadata: { order },
  });

  return withRefreshedCookies(NextResponse.json({ banners: updated }), cookieCarrier);
}
