import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';
import { attachSignedSlipUrls } from '@/lib/storage/signed-slip-url';
import { signAttachmentUrl } from '@/lib/storage/signed-attachment-url';

const ALLOWED_STATUSES = [
  'draft',
  'pending_deposit',
  'pending_verification',
  'deposit_paid',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'refunded',
] as const;

type OrderStatus = (typeof ALLOWED_STATUSES)[number];

// SECURITY (review MEDIUM 4): the PATCH handler used to accept any
// status in ALLOWED_STATUSES as a transition from any other status —
// draft -> completed, completed -> draft, refunded -> confirmed were
// all silently accepted. That's an unenforced state machine sitting
// on top of a payment/booking flow; even with a trusted admin user,
// nothing stopped a stray click or a buggy bulk-action from corrupting
// order state (e.g. re-opening a refunded order as confirmed). This
// map is the actual state machine — same linear flow the DB migrations
// already assume (021/022/029 track deposit/verification state), plus
// cancelled/refunded as terminal states reachable from the points
// where cancelling/refunding a real order makes sense.
//
// pending_verification -> pending_deposit is intentional: this is the
// "admin rejects the submitted slip" path (see
// /api/admin/payments/[id]/reject), which sends the order back to
// waiting-for-a-new-slip rather than forward.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['pending_deposit', 'cancelled'],
  pending_deposit: ['pending_verification', 'cancelled'],
  pending_verification: ['deposit_paid', 'pending_deposit', 'cancelled'],
  deposit_paid: ['confirmed', 'cancelled', 'refunded'],
  confirmed: ['checked_in', 'cancelled', 'refunded'],
  checked_in: ['completed', 'refunded'],
  completed: ['refunded'],
  cancelled: [],
  refunded: [],
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  // Used only as a place for Supabase to write a refreshed access/refresh
  // token pair into, via requireAdmin's setAll(). Never returned directly.
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);

  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: auth.message },
        { status: auth.status },
      ),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();
  const orderId = params.id;

  // 1. Order
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'id, order_number, patient_id, status, notes, attachment_url, total_amount, total_deposit_required, total_deposit_paid, total_balance_remaining, currency, created_at, cancelled_reason, payment_access_token',
    )
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    console.error('fetch order failed:', orderError);
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'Order not found' },
        { status: 404 },
      ),
      cookieCarrier
    );
  }

  // 2. Customer
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, full_name, phone, line_id, country')
    .eq('id', order.patient_id)
    .maybeSingle();

  if (customerError) {
    console.error('fetch customer failed:', customerError);
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'failed to load customer' },
        { status: 500 },
      ),
      cookieCarrier
    );
  }

  // 3. Order items
  // NOTE: this select() previously omitted quantity, room_quantity,
  // needs_assignment, hotel_checkout_date, transport_mode,
  // transport_return_date/time, pickup_location, dropoff_location —
  // every field admin/orders/[orderId]/page.tsx's itemDetailLine()
  // and the "needs assignment" badge actually render. That silently
  // blanked out hotel/transport detail lines and the assignment
  // warning on this page, even though the list view
  // (/api/admin/orders) already selected them correctly. Also adding
  // vehicle_type/passenger_count (migration 037) for parity with the
  // rest of the app, even though the page doesn't render them yet.
  const { data: items, error: itemsError } = await supabase
  .from("order_items")
  .select(`
    id,
    order_id,
    partner_id,
    package_id,
    service_type,
    price,
    room_quantity,
    deposit_required,
    deposit_paid,
    balance_remaining,
    scheduled_date,
    scheduled_time,
    status,
    needs_assignment,
    hotel_checkout_date,
    transport_mode,
    transport_return_date,
    transport_return_time,
    pickup_location,
    dropoff_location,
    vehicle_type,
    passenger_count
  `)
  .eq("order_id", params.id);

  if (itemsError) {
    console.error('fetch order items failed:', itemsError);
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'failed to load order items' },
        { status: 500 },
      ),
      cookieCarrier
    );
  }

  // 4. Packages + partners
  const packageIds = [
    ...new Set(
      (items ?? [])
        .map((item) => item.package_id)
        .filter((id): id is string => !!id),
    ),
  ];

  const partnerIds = [
    ...new Set(
      (items ?? [])
        .map((item) => item.partner_id)
        .filter((id): id is string => !!id),
    ),
  ];

  const [packagesResult, partnersResult] = await Promise.all([
    packageIds.length
      ? supabase
          .from('packages')
          .select('id, title, original_price, special_price')
          .in('id', packageIds)
      : Promise.resolve({ data: [], error: null }),

    partnerIds.length
      ? supabase
          .from('partners')
          .select('id, name')
          .in('id', partnerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (packagesResult.error) {
    console.error('fetch packages failed:', packagesResult.error);
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'failed to load packages' },
        { status: 500 },
      ),
      cookieCarrier
    );
  }

  if (partnersResult.error) {
    console.error('fetch partners failed:', partnersResult.error);
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'failed to load partners' },
        { status: 500 },
      ),
      cookieCarrier
    );
  }

  const packageById = new Map(
    (packagesResult.data ?? []).map((item) => [item.id, item]),
  );

  const partnerById = new Map(
    (partnersResult.data ?? []).map((item) => [item.id, item]),
  );

  const enrichedItems = (items ?? []).map((item) => ({
    ...item,
    package: item.package_id
      ? packageById.get(item.package_id) ?? null
      : null,
    partner: item.partner_id
      ? partnerById.get(item.partner_id) ?? null
      : null,
  }));

  // 5. Whole-order payments
  //
  // Admin owns payments where order_item_id IS NULL.
  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select(
      'id, order_id, amount, currency, method, status, slip_url, submitted_at, verified_at, rejection_reason',
    )
    .eq('order_id', orderId)
    .is('order_item_id', null)
    .order('submitted_at', { ascending: false });

  if (paymentsError) {
    console.error('fetch payments failed:', paymentsError);
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'failed to load payments' },
        { status: 500 },
      ),
      cookieCarrier
    );
  }

  // SECURITY (migration 033): payment-slips is now a private bucket.
  // The stored slip_url is the old dead public URL — swap it for a
  // freshly generated signed URL (10 min TTL) right before it goes
  // out over the wire. This is the only route that renders slips
  // (admin/orders/[orderId]/page.tsx), so this is the only place that
  // needs to do this — see also /api/admin/orders/route.ts (list
  // view), which drops slip_url entirely since it's never rendered
  // there.
  const paymentsWithSignedSlips = await attachSignedSlipUrls(payments ?? []);

  // SECURITY (migration 044): booking-attachments is now a private
  // bucket, same treatment as payment-slips got in migration 033 —
  // these are customer-uploaded medical documents/test results, not
  // marketing images. Swap the old dead public URL for a freshly
  // generated signed URL (10 min TTL) right before it goes out over
  // the wire. This is the only route that renders it
  // (admin/orders/[orderId]/page.tsx) — see also
  // /api/admin/orders/route.ts (list view), which drops
  // attachment_url entirely since it's never rendered there.
  const signedAttachmentUrl = await signAttachmentUrl(order.attachment_url);

  return withRefreshedCookies(
    NextResponse.json({
      order: {
        ...order,
        attachment_url: signedAttachmentUrl,
        customer: customer ?? null,
        items: enrichedItems,
        payments: paymentsWithSignedSlips,
      },
    }),
    cookieCarrier
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  // Used only as a place for Supabase to write a refreshed access/refresh
  // token pair into, via requireAdmin's setAll(). Never returned directly.
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);

  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: auth.message },
        { status: auth.status },
      ),
      cookieCarrier
    );
  }

  const body = await request.json().catch(() => null);
  const status = body?.status as OrderStatus | undefined;

  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return withRefreshedCookies(
      NextResponse.json(
        {
          error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}`,
        },
        { status: 400 },
      ),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  // Load current status first — the transition map needs to know
  // where we're coming FROM, not just that the target is a valid
  // status in general.
  const { data: currentOrder, error: currentErr } = await supabase
    .from('orders')
    .select('status')
    .eq('id', params.id)
    .single();

  if (currentErr || !currentOrder) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Order not found' }, { status: 404 }),
      cookieCarrier
    );
  }

  const fromStatus = currentOrder.status as OrderStatus;

  if (fromStatus !== status && !ALLOWED_TRANSITIONS[fromStatus]?.includes(status)) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: `cannot move order from "${fromStatus}" to "${status}"` },
        { status: 409 },
      ),
      cookieCarrier
    );
  }

  // .eq('status', fromStatus) guards against a concurrent status
  // change that happened between the read above and this write —
  // .select().maybeSingle() lets us tell "updated" apart from
  // "matched zero rows because status moved under us" (a plain
  // update() with no error doesn't distinguish the two).
  const { data: updated, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', params.id)
    .eq('status', fromStatus)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('update order status failed:', error);
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'failed to update status' },
        { status: 500 },
      ),
      cookieCarrier
    );
  }

  if (!updated) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'order status changed concurrently, please refresh and try again' },
        { status: 409 },
      ),
      cookieCarrier
    );
  }

  return withRefreshedCookies(NextResponse.json({ ok: true }), cookieCarrier);
}
