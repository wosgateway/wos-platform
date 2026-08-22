import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { createServiceClient } from '@/lib/supabase/service';

// สำคัญ: ป้องกัน Next.js cache ผลลัพธ์ของ route นี้แบบ static
// ถ้าไม่มีบรรทัดนี้ หลังเปลี่ยนแพ็กเกจ/สถานะแล้วเรียก GET ซ้ำ
// อาจได้ข้อมูลเก่าที่ cache ไว้กลับมา ทำให้หน้าจอดูเหมือนไม่อัปเดต
export const dynamic = "force-dynamic";

interface OrderItemRow {
  id: string;
  order_id: string;
  partner_id: string | null;
  package_id: string | null;
  service_type: string; // expected: 'main' | 'hotel' | 'transport'
  price: number | null;
  deposit_required: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  needs_assignment: boolean;
  hotel_checkout_date: string | null;
  transport_mode: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  room_quantity: number;
}

interface PackageRow {
  id: string;
  title: string;
  original_price: number | null;
  special_price: number | null;
}

interface PartnerRow {
  id: string;
  name: string;
}

type OrderItemWithRelations = OrderItemRow & {
  package: PackageRow | null;
  partner: PartnerRow | null;
};

interface PaymentRow {
  id: string;
  order_id: string;
  amount: number | null;
  currency: string | null;
  method: string | null;
  status: string;
  // slip_url intentionally NOT selected/typed here — this is the
  // list view, and no component here ever renders it. As of
  // migration 033 (private payment-slips bucket) the stored value
  // would be a dead public URL anyway; a live one would require a
  // signed-URL call per payment on every list page load. The one
  // place that DOES need to show a slip is the order detail route
  // (/api/admin/orders/[id]/route.ts), which calls
  // attachSignedSlipUrls() — see src/lib/storage/signed-slip-url.ts.
  submitted_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
}

// Copies any refreshed session cookies from the "carrier" response
// (the one requireAdmin wrote into) onto the real outgoing response.
// Every return path below goes through this so a token refresh that
// happens mid-request is never silently dropped.
function withRefreshedCookies(res: NextResponse, carrier: NextResponse): NextResponse {
  carrier.cookies.getAll().forEach((cookie) => {
    res.cookies.set(cookie);
  });
  return res;
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

  // 1. Orders
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select(
      'id, order_number, patient_id, status, notes, attachment_url, total_amount, total_deposit_required, total_deposit_paid, total_balance_remaining, currency, created_at, payment_access_token'
    )
    .order('created_at', { ascending: false });

  if (ordersErr) {
    console.error('fetch orders failed:', ordersErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load orders' }, { status: 500 }),
      cookieCarrier
    );
  }
  if (!orders || orders.length === 0) {
    return withRefreshedCookies(NextResponse.json({ orders: [] }), cookieCarrier);
  }

  const orderIds = orders.map((o) => o.id);
  const patientIds = [...new Set(orders.map((o) => o.patient_id))];

  // 2. Order items for those orders
  // NOTE: this list previously never selected pickup_location /
  // dropoff_location (migration 024/025 added the columns but this
  // route wasn't updated — admin UI silently showed undefined for
  // both) — and now also needs room_quantity (migration 028), and
  // vehicle_type/passenger_count (migration 037). All fixed here
  // together.
  const { data: items, error: itemsErr } = await supabase
  .from('order_items')
  .select(
    'id, order_id, partner_id, package_id, service_type, price, deposit_required, scheduled_date, scheduled_time, needs_assignment, hotel_checkout_date, transport_mode, transport_return_date, transport_return_time, pickup_location, dropoff_location, room_quantity, vehicle_type, passenger_count'
  )
  .in('order_id', orderIds)

  if (itemsErr) {
    console.error('fetch order_items failed:', itemsErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load order items' }, { status: 500 }),
      cookieCarrier
    );
  }

  // 3. Customers
  const { data: customers, error: customersErr } = await supabase
    .from('customers')
    .select('id, full_name, phone, line_id, country')
    .in('id', patientIds);

  if (customersErr) {
    console.error('fetch customers failed:', customersErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load customers' }, { status: 500 }),
      cookieCarrier
    );
  }

  // 3b. Whole-order payments (order_item_id IS NULL) — these are the
  // ones an admin verifies/rejects via /api/admin/payments/[id]/verify
  // and /reject (see those routes' headers for why partner-scoped
  // payments are excluded here). Used by the admin order detail page
  // to render a Payments section with Verify/Reject actions.
  const { data: payments, error: paymentsErr } = await supabase
    .from('payments')
    .select('id, order_id, amount, currency, method, status, submitted_at, verified_at, rejection_reason')
    .in('order_id', orderIds)
    .is('order_item_id', null)
    .order('submitted_at', { ascending: false });

  if (paymentsErr) {
    console.error('fetch payments failed:', paymentsErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load payments' }, { status: 500 }),
      cookieCarrier
    );
  }

  const paymentsByOrder = new Map<string, PaymentRow[]>();
  for (const payment of (payments ?? []) as PaymentRow[]) {
    const list = paymentsByOrder.get(payment.order_id) ?? [];
    list.push(payment);
    paymentsByOrder.set(payment.order_id, list);
  }

  // 4. Packages + partners referenced by items (only the ones actually assigned)
  const packageIds = [
    ...new Set((items ?? []).map((i) => i.package_id).filter((v): v is string => !!v)),
  ];
  const partnerIds = [
    ...new Set((items ?? []).map((i) => i.partner_id).filter((v): v is string => !!v)),
  ];

  const [packagesRes, partnersRes] = await Promise.all([
    packageIds.length
      ? supabase.from('packages').select('id, title, original_price, special_price').in('id', packageIds)
      : Promise.resolve({
          data: [] as PackageRow[],
          error: null,
        }),
    partnerIds.length
      ? supabase.from('partners').select('id, name').in('id', partnerIds)
      : Promise.resolve({
          data: [] as PartnerRow[],
          error: null,
        }),
  ]);

  if (packagesRes.error) {
    console.error('fetch packages failed:', packagesRes.error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load packages' }, { status: 500 }),
      cookieCarrier
    );
  }
  if (partnersRes.error) {
    console.error('fetch partners failed:', partnersRes.error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load partners' }, { status: 500 }),
      cookieCarrier
    );
  }

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const packageById = new Map((packagesRes.data ?? []).map((p) => [p.id, p]));
  const partnerById = new Map((partnersRes.data ?? []).map((p) => [p.id, p]));

  const itemsByOrder = new Map<string, OrderItemWithRelations[]>();
  for (const item of (items ?? []) as OrderItemRow[]) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push({
      ...item,
      package: item.package_id ? packageById.get(item.package_id) ?? null : null,
      partner: item.partner_id ? partnerById.get(item.partner_id) ?? null : null,
    });
    itemsByOrder.set(item.order_id, list);
  }

  const enriched = orders.map((order) => ({
    ...order,
    customer: customerById.get(order.patient_id) ?? null,
    items: itemsByOrder.get(order.id) ?? [],
    payments: paymentsByOrder.get(order.id) ?? [],
  }));

  return withRefreshedCookies(NextResponse.json({ orders: enriched }), cookieCarrier);
}
