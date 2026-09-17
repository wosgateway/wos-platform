// src/app/api/admin/settlements/[id]/route.ts
//
// GET /api/admin/settlements/:id
//
// Detail view backing the settlement drill-down screen: the settlement
// row itself (partner, period, totals, status, who-did-each-transition
// — approved_by/paid_by/locked_by from 107), plus every
// settlement_items row that was frozen into it by calculate_settlement,
// enriched with just enough order/package context (order_number,
// package title) for an admin to recognize what they're looking at
// without a separate lookup per line.
//
// Four plain queries instead of nested PostgREST embeds — same
// reasoning as the list route and order-items/pending/route.ts: none
// of the auto-generated FK constraint names used for embeds are
// asserted anywhere else in this codebase, so guessing one is a
// needless way to break. settlement_items rows are already frozen at
// calculate_settlement time (105/107) — this route is read-only and
// never recomputes commission_amount/partner_balance from order_items.

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
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

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  const settlementId = params.id;
  const supabase = createServiceClient();

  // 1. Settlement
  const { data: settlement, error: settlementErr } = await supabase
    .from('settlements')
    .select(
      'id, partner_id, period_start, period_end, total_commission_due, item_count, status, created_by, approved_by, paid_by, locked_by, approved_at, paid_at, locked_at, created_at, updated_at'
    )
    .eq('id', settlementId)
    .maybeSingle();

  if (settlementErr) {
    console.error('fetch settlement failed:', settlementErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load settlement: ' + settlementErr.message }, { status: 500 }),
      cookieCarrier
    );
  }
  if (!settlement) {
    return withRefreshedCookies(NextResponse.json({ error: 'Settlement not found' }, { status: 404 }), cookieCarrier);
  }

  // 2. Partner
  const { data: partner, error: partnerErr } = await supabase
    .from('partners')
    .select('id, name, category, status')
    .eq('id', settlement.partner_id)
    .maybeSingle();
  if (partnerErr) {
    console.error('fetch partner for settlement failed:', partnerErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load partner: ' + partnerErr.message }, { status: 500 }),
      cookieCarrier
    );
  }

  // 3. Settlement line items (frozen at calculate_settlement time)
  const { data: settlementItems, error: itemsErr } = await supabase
    .from('settlement_items')
    .select('id, settlement_id, order_item_id, partner_balance, commission_amount, created_at')
    .eq('settlement_id', settlementId)
    .order('created_at', { ascending: true });
  if (itemsErr) {
    console.error('fetch settlement_items failed:', itemsErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load settlement items: ' + itemsErr.message }, { status: 500 }),
      cookieCarrier
    );
  }

  const items = (settlementItems ?? []) as SettlementItemRow[];
  if (items.length === 0) {
    // Shouldn't happen in practice — calculate_settlement rolls back
    // and never persists a settlement with zero items (see 107's
    // header) — but the detail view should degrade gracefully rather
    // than 500 if it ever does (e.g. a future manual DB edit).
    return withRefreshedCookies(
      NextResponse.json({ settlement: { ...settlement, partner: partner ?? null }, items: [] }),
      cookieCarrier
    );
  }

  // 4. order_items referenced by those settlement_items
  const orderItemIds = items.map((i) => i.order_item_id);
  const { data: orderItems, error: orderItemsErr } = await supabase
    .from('order_items')
    .select('id, order_id, package_id, service_type, completed_at')
    .in('id', orderItemIds);
  if (orderItemsErr) {
    console.error('fetch order_items for settlement failed:', orderItemsErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load order items: ' + orderItemsErr.message }, { status: 500 }),
      cookieCarrier
    );
  }
  const orderItemById = new Map(((orderItems ?? []) as OrderItemRow[]).map((oi) => [oi.id, oi]));

  // 5. orders (for order_number) + packages (for title) referenced above
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
    console.error('fetch orders for settlement failed:', ordersRes.error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to load orders: ' + ordersRes.error.message }, { status: 500 }),
      cookieCarrier
    );
  }
  if (packagesRes.error) {
    console.error('fetch packages for settlement failed:', packagesRes.error);
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
            orderId: orderItem.order_id,
            orderNumber: order?.order_number ?? null,
            packageTitle: pkg?.title ?? null,
          }
        : null,
    };
  });

  return withRefreshedCookies(
    NextResponse.json({
      settlement: { ...settlement, partner: partner ?? null },
      items: enrichedItems,
    }),
    cookieCarrier
  );
}
