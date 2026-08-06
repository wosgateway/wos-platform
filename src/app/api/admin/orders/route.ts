import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { createServiceClient } from '@/lib/supabase/service';

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

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const supabase = createServiceClient();

  // 1. Orders
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select(
      'id, order_number, patient_id, status, notes, attachment_url, total_amount, total_deposit_required, currency, created_at'
    )
    .order('created_at', { ascending: false });

  if (ordersErr) {
    console.error('fetch orders failed:', ordersErr);
    return NextResponse.json({ error: 'failed to load orders' }, { status: 500 });
  }
  if (!orders || orders.length === 0) {
    return NextResponse.json({ orders: [] });
  }

  const orderIds = orders.map((o) => o.id);
  const patientIds = [...new Set(orders.map((o) => o.patient_id))];

  // 2. Order items for those orders
  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select(
      'id, order_id, partner_id, package_id, service_type, price, deposit_required, scheduled_date, scheduled_time, needs_assignment, hotel_checkout_date, transport_mode, transport_return_date, transport_return_time'
    )
    .in('order_id', orderIds);

  if (itemsErr) {
    console.error('fetch order_items failed:', itemsErr);
    return NextResponse.json({ error: 'failed to load order items' }, { status: 500 });
  }

  // 3. Customers
  const { data: customers, error: customersErr } = await supabase
    .from('customers')
    .select('id, full_name, phone, line_id, country')
    .in('id', patientIds);

  if (customersErr) {
    console.error('fetch customers failed:', customersErr);
    return NextResponse.json({ error: 'failed to load customers' }, { status: 500 });
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
    return NextResponse.json({ error: 'failed to load packages' }, { status: 500 });
  }
  if (partnersRes.error) {
    console.error('fetch partners failed:', partnersRes.error);
    return NextResponse.json({ error: 'failed to load partners' }, { status: 500 });
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
  }));

  return NextResponse.json({ orders: enriched });
}