// src/app/api/partner/settlements/[id]/route.ts
//
// GET /api/partner/settlements/:id
//
// Detail view backing the partner-portal settlement drill-down —
// scoped mirror of /api/admin/settlements/[id]/route.ts (Phase 3).
// Same four-plain-queries shape and the same reasoning (no guessed
// PostgREST embed names), with two differences from the admin route:
//
//   1. Ownership check: the settlement must belong to the CALLING
//      partner (user.branch?.partner_id). A settlement that exists
//      but belongs to someone else 404s — same as it not existing at
//      all — rather than a 403, so a partner probing random ids can't
//      learn which settlement ids belong to other partners.
//   2. No customer PII: order_items carries no customer name/phone to
//      begin with (same fields the admin route already selects —
//      order_number, package title, service_type, completed_at), so
//      partners see exactly which orders make up their commission
//      bill without any lookup into `customers`. Nothing to strip;
//      just nothing extra to add.
//
// Read-only, service-role client — same reasoning as
// /api/partner/settlements/route.ts.

import { NextResponse } from 'next/server';

import { getPartnerSession } from '@/lib/partner/auth';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface SettlementItemRow {
  id: string;
  settlement_id: string;
  order_item_id: string;
  partner_balance: number;
  commission_amount: number;
  created_at: string;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  package_id: string | null;
  service_type: string;
  completed_at: string | null;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();
  const { user } = await getPartnerSession(cookieCarrier);

  if (!user) {
    return withRefreshedCookies(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cookieCarrier);
  }

  const partnerId = user.branch?.partner_id ?? null;
  if (!partnerId) {
    return withRefreshedCookies(NextResponse.json({ error: 'Settlement not found' }, { status: 404 }), cookieCarrier);
  }

  const settlementId = params.id;
  const supabase = createServiceClient();

  // 1. Settlement — no approved_by/paid_by/locked_by/created_by here:
  // those are admin.users.id references with nothing a partner should
  // resolve to a name, and the admin route's use of them (audit
  // trail) isn't this view's job.
  const { data: settlement, error: settlementErr } = await supabase
    .from('settlements')
    .select(
      'id, partner_id, period_start, period_end, total_commission_due, item_count, status, approved_at, paid_at, locked_at, created_at, updated_at'
    )
    .eq('id', settlementId)
    .maybeSingle();

  if (settlementErr) {
    console.error('fetch partner settlement failed:', settlementErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load settlement: ' + settlementErr.message }, { status: 500 }),
      cookieCarrier
    );
  }
  if (!settlement || settlement.partner_id !== partnerId) {
    // Ownership mismatch reads as not-found — see file header.
    return withRefreshedCookies(NextResponse.json({ error: 'Settlement not found' }, { status: 404 }), cookieCarrier);
  }

  // 2. Settlement line items (frozen at calculate_settlement time)
  const { data: settlementItems, error: itemsErr } = await supabase
    .from('settlement_items')
    .select('id, settlement_id, order_item_id, partner_balance, commission_amount, created_at')
    .eq('settlement_id', settlementId)
    .order('created_at', { ascending: true });
  if (itemsErr) {
    console.error('fetch partner settlement_items failed:', itemsErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load settlement items: ' + itemsErr.message }, { status: 500 }),
      cookieCarrier
    );
  }

  const items = (settlementItems ?? []) as SettlementItemRow[];
  if (items.length === 0) {
    return withRefreshedCookies(NextResponse.json({ settlement, items: [] }), cookieCarrier);
  }

  // 3. order_items referenced by those settlement_items
  const orderItemIds = items.map((i) => i.order_item_id);
  const { data: orderItems, error: orderItemsErr } = await supabase
    .from('order_items')
    .select('id, order_id, package_id, service_type, completed_at')
    .in('id', orderItemIds);
  if (orderItemsErr) {
    console.error('fetch order_items for partner settlement failed:', orderItemsErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load order items: ' + orderItemsErr.message }, { status: 500 }),
      cookieCarrier
    );
  }
  const orderItemById = new Map(((orderItems ?? []) as OrderItemRow[]).map((oi) => [oi.id, oi]));

  // 4. orders (for order_number) + packages (for title) referenced above
  const orderIds = [...new Set(((orderItems ?? []) as OrderItemRow[]).map((oi) => oi.order_id))];
  const packageIds = [
    ...new Set(((orderItems ?? []) as OrderItemRow[]).map((oi) => oi.package_id).filter((v): v is string => !!v)),
  ];

  const [ordersRes, packagesRes] = await Promise.all([
    orderIds.length
      ? supabase.from('orders').select('id, order_number').in('id', orderIds)
      : Promise.resolve({ data: [] as { id: string; order_number: string }[], error: null }),
    packageIds.length
      ? supabase.from('packages').select('id, title').in('id', packageIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
  ]);
  if (ordersRes.error) {
    console.error('fetch orders for partner settlement failed:', ordersRes.error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load orders: ' + ordersRes.error.message }, { status: 500 }),
      cookieCarrier
    );
  }
  if (packagesRes.error) {
    console.error('fetch packages for partner settlement failed:', packagesRes.error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load packages: ' + packagesRes.error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  const orderById = new Map((ordersRes.data ?? []).map((o) => [o.id, o]));
  const packageById = new Map((packagesRes.data ?? []).map((p) => [p.id, p]));

  const enrichedItems = items.map((item) => {
    const orderItem = orderItemById.get(item.order_item_id) ?? null;
    const order = orderItem ? orderById.get(orderItem.order_id) ?? null : null;
    const pkg = orderItem?.package_id ? packageById.get(orderItem.package_id) ?? null : null;
    return {
      ...item,
      orderItem: orderItem
        ? {
            id: orderItem.id,
            serviceType: orderItem.service_type,
            completedAt: orderItem.completed_at,
            orderNumber: order?.order_number ?? null,
            packageTitle: pkg?.title ?? null,
          }
        : null,
    };
  });

  return withRefreshedCookies(NextResponse.json({ settlement, items: enrichedItems }), cookieCarrier);
}
