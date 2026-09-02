// app/api/admin/overview/route.ts
//
// PHASE 5 — "Control Center เพิ่ม Task view" from the 5-phase plan.
// Per the plan: "ไม่ต้องสร้างระบบ Task แยกต่างหาก ใช้ status ของ
// order_items เป็นตัวบอก pending ได้เลย" — no new task table, derive
// "what's pending / who needs to act" entirely from existing
// orders/order_items/payments status columns.
//
// This intentionally widens the scope of the existing
// /api/admin/order-items/pending route (needs_assignment=true only)
// to the other 2 things staff actually wait on day-to-day:
//   1. UNASSIGNED    — needs_assignment=true (existing pending route's
//                       definition; hotel/transport "let team decide")
//   2. AWAITING PARTNER CONFIRMATION — already assigned
//                       (package_id set) but the partner hasn't moved
//                       the item past 'pending' yet
//   3. PAYMENT VERIFICATION QUEUE — a payment slip sitting in
//                       'pending' / 'waiting_verification'
// "Active journeys" and "ready" counts are included for the dashboard
// header shape from the plan's mockup, but are informational only —
// nothing links off of them, unlike the 3 action buckets above.
//
// Same reasoning as pending/route.ts for doing several plain queries
// instead of one nested PostgREST select: the FK constraint names
// Supabase auto-generates for orders/order_items/customers/payments
// aren't recorded anywhere in this codebase, so a guessed nested
// select can fail loudly on a naming mismatch. A few more queries
// here is a small, predictable cost for that.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

export interface OverviewActionItem {
  kind: 'unassigned' | 'awaiting_partner_confirmation' | 'payment_pending';
  order_item_id: string | null;
  payment_id: string | null;
  order_id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  service_type: string | null;
  amount: number | null;
  currency: string | null;
  created_at: string;
}

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

  // --- Counts (dashboard header) ---------------------------------

  const { count: activeJourneys, error: activeErr } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .in('status', ['deposit_paid', 'confirmed', 'checked_in']);

  const { count: readyItems, error: readyErr } = await supabase
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'confirmed');

  if (activeErr || readyErr) {
    console.error('overview counts failed:', activeErr ?? readyErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load overview counts' }, { status: 500 }),
      cookieCarrier
    );
  }

  // --- Action buckets ----------------------------------------------

  const { data: unassignedItems, error: unassignedErr } = await supabase
    .from('order_items')
    .select('id, order_id, service_type, created_at')
    .eq('needs_assignment', true)
    .order('created_at', { ascending: true });

  const { data: awaitingConfirmationItems, error: awaitingErr } = await supabase
    .from('order_items')
    .select('id, order_id, service_type, created_at')
    .eq('needs_assignment', false)
    .eq('status', 'pending')
    .not('package_id', 'is', null)
    .order('created_at', { ascending: true });

  const { data: pendingPayments, error: pendingPaymentsErr } = await supabase
    .from('payments')
    .select('id, order_id, order_item_id, amount, currency, created_at')
    .in('status', ['pending', 'waiting_verification'])
    .order('created_at', { ascending: true });

  if (unassignedErr || awaitingErr || pendingPaymentsErr) {
    console.error(
      'overview action buckets failed:',
      unassignedErr ?? awaitingErr ?? pendingPaymentsErr
    );
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load pending items' }, { status: 500 }),
      cookieCarrier
    );
  }

  // --- Enrich with order_number / customer, same pattern as the
  // existing pending/route.ts: collect every order_id we need across
  // all 3 buckets, fetch orders once, then customers once. -------

  const orderIds = new Set<string>();
  for (const item of unassignedItems ?? []) orderIds.add(item.order_id);
  for (const item of awaitingConfirmationItems ?? []) orderIds.add(item.order_id);
  for (const payment of pendingPayments ?? []) orderIds.add(payment.order_id);

  const { data: orders, error: ordersErr } = orderIds.size
    ? await supabase
        .from('orders')
        .select('id, order_number, patient_id')
        .in('id', [...orderIds])
    : { data: [], error: null };

  if (ordersErr) {
    console.error('overview order lookup failed:', ordersErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load order context' }, { status: 500 }),
      cookieCarrier
    );
  }

  const patientIds = [...new Set((orders ?? []).map((o) => o.patient_id))];
  const { data: customers, error: customersErr } = patientIds.length
    ? await supabase.from('customers').select('id, full_name, phone').in('id', patientIds)
    : { data: [], error: null };

  if (customersErr) {
    console.error('overview customer lookup failed:', customersErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load customer context' }, { status: 500 }),
      cookieCarrier
    );
  }

  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));

  function contextFor(orderId: string) {
    const order = orderById.get(orderId);
    const customer = order ? customerById.get(order.patient_id) : undefined;
    return {
      order_number: order?.order_number ?? null,
      customer_name: customer?.full_name ?? null,
      customer_phone: customer?.phone ?? null,
    };
  }

  const actionItems: OverviewActionItem[] = [
    ...(unassignedItems ?? []).map((item) => ({
      kind: 'unassigned' as const,
      order_item_id: item.id,
      payment_id: null,
      order_id: item.order_id,
      service_type: item.service_type,
      amount: null,
      currency: null,
      created_at: item.created_at,
      ...contextFor(item.order_id),
    })),
    ...(awaitingConfirmationItems ?? []).map((item) => ({
      kind: 'awaiting_partner_confirmation' as const,
      order_item_id: item.id,
      payment_id: null,
      order_id: item.order_id,
      service_type: item.service_type,
      amount: null,
      currency: null,
      created_at: item.created_at,
      ...contextFor(item.order_id),
    })),
    ...(pendingPayments ?? []).map((payment) => ({
      kind: 'payment_pending' as const,
      order_item_id: payment.order_item_id,
      payment_id: payment.id,
      order_id: payment.order_id,
      service_type: null,
      amount: payment.amount,
      currency: payment.currency,
      created_at: payment.created_at,
      ...contextFor(payment.order_id),
    })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return withRefreshedCookies(
    NextResponse.json({
      counts: {
        activeJourneys: activeJourneys ?? 0,
        readyItems: readyItems ?? 0,
        unassigned: unassignedItems?.length ?? 0,
        awaitingPartnerConfirmation: awaitingConfirmationItems?.length ?? 0,
        paymentPending: pendingPayments?.length ?? 0,
      },
      items: actionItems,
    }),
    cookieCarrier
  );
}
