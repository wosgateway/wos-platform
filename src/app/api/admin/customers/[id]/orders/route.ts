// src/app/api/admin/customers/[id]/orders/route.ts
//
// GET /api/admin/customers/[id]/orders — used by the Journey Control
// Center's "create trip" flow (see JourneysManager.tsx's
// CreateTripSheet). Once an admin picks a customer via
// /api/admin/customers/search, this returns that customer's orders so
// the trip's start_date/end_date can be pre-filled from an order's
// existing item dates instead of the admin re-typing dates that were
// already entered at booking time.
//
// `customers` and `orders`/`order_items` have no anon/authenticated
// RLS policies that would let the browser client read across
// customers (see 011_create_customers_table.sql / 001_schema_and_rls.sql),
// so this needs its own service-role route, same reasoning as
// customers/search/route.ts.
//
// Only active orders are returned (draft/pending_deposit/pending_verification/
// deposit_paid/confirmed) — a cancelled order's dates are exactly the
// dates an admin should NOT be pre-filling a new trip from.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { createServiceClient } from '@/lib/supabase/service';
import { withCarriedCookies } from '@/lib/trips/with-carried-cookies';

const ACTIVE_STATUSES = [
  'draft',
  'pending_deposit',
  'pending_verification',
  'deposit_paid',
  'confirmed',
];

interface OrderItemDateRow {
  order_id: string;
  service_type: string;
  scheduled_date: string | null;
  hotel_checkout_date: string | null;
  transport_return_date: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const supabase = createServiceClient();

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, order_number, status, created_at')
    .eq('patient_id', params.id)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false });

  if (ordersErr) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: 'failed to load orders', detail: ordersErr.message }, { status: 500 })
    );
  }

  if (!orders || orders.length === 0) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ orders: [] }));
  }

  const orderIds = orders.map((o) => o.id);

  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select(
      'order_id, service_type, scheduled_date, hotel_checkout_date, transport_return_date, pickup_location, dropoff_location'
    )
    .in('order_id', orderIds);

  if (itemsErr) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: 'failed to load order items', detail: itemsErr.message }, { status: 500 })
    );
  }

  const itemsByOrder = new Map<string, OrderItemDateRow[]>();
  for (const item of (items ?? []) as OrderItemDateRow[]) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  // Derive a suggested [start_date, end_date] per order: the earliest
  // scheduled_date across its items as the start, and the latest of
  // scheduled_date / hotel_checkout_date / transport_return_date as
  // the end (a hotel-only or one-way-transport order has no separate
  // "end", so it just collapses to a single-day trip — still saves
  // typing the same date twice). Also surface the first transport
  // item's pickup/dropoff location text, in case the admin wants it
  // for the trip's origin/destination fields — free text on both
  // sides, so this is a hint, not an auto-fill; wording rarely maps
  // cleanly onto province-level origin/destination.
  const result = orders.map((order) => {
    const orderItems = itemsByOrder.get(order.id) ?? [];
    const dates = orderItems
      .flatMap((i) => [i.scheduled_date, i.hotel_checkout_date, i.transport_return_date])
      .filter((d): d is string => Boolean(d))
      .sort();
    const transportItem = orderItems.find((i) => i.service_type === 'transport') ?? null;

    return {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      created_at: order.created_at,
      suggested_start_date: dates[0] ?? null,
      suggested_end_date: dates.length > 0 ? dates[dates.length - 1] : null,
      pickup_location_hint: transportItem?.pickup_location ?? null,
      dropoff_location_hint: transportItem?.dropoff_location ?? null,
    };
  });

  return withCarriedCookies(cookieCarrier, NextResponse.json({ orders: result }));
}
