// src/lib/partner/orders.ts
//
// Read-side helper for GET /api/partner/orders/[id] (BookingDetailModal.tsx).
//
// Uses the service-role client, not the cookie-bound one: `customers`
// has RLS enabled with zero policies (migration 011 — service-role
// only, no customer-facing auth session to key a policy off of), so
// a regular session-bound client would always get `null` back for
// the embedded customer. Ownership is enforced here in application
// code instead of relying on `order_items` RLS, since that policy
// checks organizations.partner_id (migration 010) while the portal
// actually resolves partnerId via users.branch_id -> branches.partner_id
// (see DashboardMetrics.tsx) — the two don't necessarily agree yet.
//
// The route handler (route.ts) already verifies the caller's session
// and resolves their partnerId before calling this function, so by
// the time we're here the only question is "does this order have any
// items belonging to that partner".
//
// 2026-08: added attachment_url (orders.attachment_url, migration
// 013) and partner_notes (order_items.partner_notes, migration 035)
// so BookingDetailModal.tsx has something to render/edit for both —
// neither was selected here before, even though both columns already
// existed (attachment_url) or now exist (partner_notes).
import { createServiceClient } from '@/lib/supabase/service';

export interface PartnerOrderItem {
  id: string;
  package_id: string | null;
  service_type: string;
  price: number;
  quantity: number | null;
  room_quantity: number | null;
  deposit_required: number;
  deposit_paid: number;
  balance_remaining: number;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  hotel_checkout_date: string | null;
  transport_mode: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  partner_notes: string | null;
  packages: { id: string; title: string } | null;
}

export interface PartnerOrder {
  id: string;
  order_number: string;
  status: string;
  currency: string;
  total_amount: number;
  total_deposit_required: number;
  total_deposit_paid: number;
  total_balance_remaining: number;
  notes: string | null;
  attachment_url: string | null;
  created_at: string;
  customer: {
    full_name: string;
    phone: string;
    email: string | null;
    line_id: string | null;
    country: string | null;
  } | null;
  items: PartnerOrderItem[];
}

// Raw shape as returned by PostgREST before we strip partner_id back
// out of each item (partner_id is only needed here to filter — the
// caller doesn't need it echoed back).
interface RawOrderItem extends PartnerOrderItem {
  partner_id: string;
}

interface RawOrder {
  id: string;
  order_number: string;
  status: string;
  currency: string;
  total_amount: number;
  total_deposit_required: number;
  total_deposit_paid: number;
  total_balance_remaining: number;
  notes: string | null;
  attachment_url: string | null;
  created_at: string;
  // postgrest-js เดา type ของ embedded relation เป็น array แม้ runtime
  // จะคืน object เดียวเสมอ (many-to-one ผ่าน patient_id) — cast ให้ตรงจริง
  customers: PartnerOrder['customer'] | PartnerOrder['customer'][] | null;
  order_items: RawOrderItem[] | null;
}

export async function getPartnerOrderById(
  partnerId: string,
  orderId: string
): Promise<PartnerOrder | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('orders')
    .select(
      `
      id,
      order_number,
      status,
      currency,
      total_amount,
      total_deposit_required,
      total_deposit_paid,
      total_balance_remaining,
      notes,
      attachment_url,
      created_at,
      customers:patient_id (
        full_name,
        phone,
        email,
        line_id,
        country
      ),
      order_items (
        id,
        partner_id,
        package_id,
        service_type,
        price,
        quantity,
        room_quantity,
        deposit_required,
        deposit_paid,
        balance_remaining,
        status,
        scheduled_date,
        scheduled_time,
        hotel_checkout_date,
        transport_mode,
        transport_return_date,
        transport_return_time,
        pickup_location,
        dropoff_location,
        partner_notes,
        packages ( id, title )
      )
    `
    )
    .eq('id', orderId)
    .single();

  if (error || !data) {
    return null;
  }

  const order = data as unknown as RawOrder;

  const ownedItems = (order.order_items ?? []).filter(
    (item) => item.partner_id === partnerId
  );

  // Order exists but none of its items belong to this partner — same
  // "not found" response as an order that doesn't exist at all, so
  // the route can't be used to probe for other partners' order ids.
  if (ownedItems.length === 0) {
    return null;
  }

  const customer = Array.isArray(order.customers)
    ? order.customers[0] ?? null
    : order.customers ?? null;

  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    currency: order.currency,
    total_amount: order.total_amount,
    total_deposit_required: order.total_deposit_required,
    total_deposit_paid: order.total_deposit_paid,
    total_balance_remaining: order.total_balance_remaining,
    notes: order.notes,
    attachment_url: order.attachment_url,
    created_at: order.created_at,
    customer,
    items: ownedItems.map((item) => ({
      id: item.id,
      package_id: item.package_id,
      service_type: item.service_type,
      price: item.price,
      quantity: item.quantity,
      room_quantity: item.room_quantity,
      deposit_required: item.deposit_required,
      deposit_paid: item.deposit_paid,
      balance_remaining: item.balance_remaining,
      status: item.status,
      scheduled_date: item.scheduled_date,
      scheduled_time: item.scheduled_time,
      hotel_checkout_date: item.hotel_checkout_date,
      transport_mode: item.transport_mode,
      transport_return_date: item.transport_return_date,
      transport_return_time: item.transport_return_time,
      pickup_location: item.pickup_location,
      dropoff_location: item.dropoff_location,
      partner_notes: item.partner_notes,
      packages: item.packages,
    })),
  };
}

// ============================================================
// List path — replaces the old `partner_bookings` queries in
// RecentBookings.tsx / BookingsList.tsx / ExportBookings.tsx /
// AnalyticsDashboard.tsx (see api/partner/orders/route.ts).
//
// One row per order_item owned by this partner (not one row per
// order) — an order can contain items from multiple partners, and
// each of those legacy components rendered "one booking = one row",
// so this keeps that shape rather than nesting items under orders.
// ============================================================

export interface PartnerOrderListItem {
  id: string; // order_items.id — stable per-row key for the list UI
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_line: string | null;
  customer_country: string | null;
  service_type: string;
  status: string; // order_items status: pending | confirmed | checked_in | completed | cancelled | refunded
  price: number;
  quantity: number | null;
  room_quantity: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  hotel_checkout_date: string | null;
  transport_mode: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  created_at: string; // orders.created_at
  packages: { title: string } | null;
}

interface RawOrderListRow {
  id: string;
  order_id: string;
  package_id: string | null;
  service_type: string;
  price: number;
  quantity: number | null;
  room_quantity: number | null;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  hotel_checkout_date: string | null;
  transport_mode: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  packages: { title: string } | { title: string }[] | null;
  orders: {
    order_number: string;
    created_at: string;
    customers: PartnerOrder['customer'] | PartnerOrder['customer'][] | null;
  } | {
    order_number: string;
    created_at: string;
    customers: PartnerOrder['customer'] | PartnerOrder['customer'][] | null;
  }[] | null;
}

export async function getPartnerOrders(
  partnerId: string
): Promise<PartnerOrderListItem[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('order_items')
    .select(
      `
      id,
      order_id,
      package_id,
      service_type,
      price,
      quantity,
      room_quantity,
      status,
      scheduled_date,
      scheduled_time,
      hotel_checkout_date,
      transport_mode,
      transport_return_date,
      transport_return_time,
      pickup_location,
      dropoff_location,
      packages ( title ),
      orders!inner (
        order_number,
        created_at,
        customers:patient_id ( full_name, phone, line_id, country )
      )
    `
    )
    .eq('partner_id', partnerId)
    .order('created_at', { referencedTable: 'orders', ascending: false });

  if (error || !data) {
    return [];
  }

  const rows = data as unknown as RawOrderListRow[];

  return rows.map((row) => {
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const customer = order
      ? Array.isArray(order.customers)
        ? order.customers[0] ?? null
        : order.customers ?? null
      : null;
    const pkg = Array.isArray(row.packages) ? row.packages[0] ?? null : row.packages;

    return {
      id: row.id,
      order_id: row.order_id,
      order_number: order?.order_number ?? '',
      customer_name: customer?.full_name ?? '',
      customer_phone: customer?.phone ?? '',
      customer_line: customer?.line_id ?? null,
      customer_country: customer?.country ?? null,
      service_type: row.service_type,
      status: row.status,
      price: row.price,
      quantity: row.quantity,
      room_quantity: row.room_quantity,
      scheduled_date: row.scheduled_date,
      scheduled_time: row.scheduled_time,
      hotel_checkout_date: row.hotel_checkout_date,
      transport_mode: row.transport_mode,
      transport_return_date: row.transport_return_date,
      transport_return_time: row.transport_return_time,
      pickup_location: row.pickup_location,
      dropoff_location: row.dropoff_location,
      created_at: order?.created_at ?? '',
      packages: pkg,
    };
  });
}
