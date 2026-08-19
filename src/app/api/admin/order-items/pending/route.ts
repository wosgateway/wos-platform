// app/api/admin/order-items/pending/route.ts
//
// Lists order_items rows still awaiting admin assignment
// (needs_assignment = true — "let team decide" hotel/transport
// items from BookingForm.tsx, see migration 013/014).
//
// Deliberately does 3 separate queries instead of one PostgREST
// nested select (order_items -> orders -> customers): the FK
// constraint names Supabase auto-generates aren't known here (they
// weren't in any file reviewed), and a nested select with a guessed
// constraint name fails loudly if wrong. Three plain queries are a
// few more lines but can't break on a naming mismatch.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

export async function GET() {
  // Used only as a place for Supabase to write a refreshed access/refresh
  // token pair into, via requireAdmin's setAll(). Never returned directly.
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select(
      'id, order_id, service_type, scheduled_date, scheduled_time, hotel_checkout_date, transport_mode, transport_return_date, transport_return_time, pickup_location, dropoff_location, room_quantity, created_at'
    )
    .eq('needs_assignment', true)
    .order('created_at', { ascending: true });

  if (itemsErr) {
    console.error('fetch pending order_items failed:', itemsErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load pending items' }, { status: 500 }),
      cookieCarrier
    );
  }
  if (!items || items.length === 0) {
    return withRefreshedCookies(NextResponse.json({ items: [] }), cookieCarrier);
  }

  const orderIds = [...new Set(items.map((i) => i.order_id))];
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, order_number, patient_id')
    .in('id', orderIds);

  if (ordersErr) {
    console.error('fetch orders for pending items failed:', ordersErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load order context' }, { status: 500 }),
      cookieCarrier
    );
  }

  const patientIds = [...new Set((orders ?? []).map((o) => o.patient_id))];
  const { data: customers, error: customersErr } = await supabase
    .from('customers')
    .select('id, full_name, phone')
    .in('id', patientIds);

  if (customersErr) {
    console.error('fetch customers for pending items failed:', customersErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load customer context' }, { status: 500 }),
      cookieCarrier
    );
  }

  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));

  const enriched = items.map((item) => {
    const order = orderById.get(item.order_id);
    const customer = order ? customerById.get(order.patient_id) : undefined;
    return {
      ...item,
      order_number: order?.order_number ?? null,
      customer_name: customer?.full_name ?? null,
      customer_phone: customer?.phone ?? null,
    };
  });

  return withRefreshedCookies(NextResponse.json({ items: enriched }), cookieCarrier);
}
