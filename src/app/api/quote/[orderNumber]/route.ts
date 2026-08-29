// app/api/quote/[orderNumber]/route.ts
//
// PUBLIC endpoint — no auth (customers open this from a link sent via
// WhatsApp/LINE/SMS, see send-quotation/route.tsx). Looks up by
// order_number (not id) since that's what's in the link. Uses the same
// 3-step fetch pattern as /api/admin/orders/route.ts (no nested
// PostgREST selects — FK names not confirmed from migrations).
//
// SECURITY: order_number is a predictable sequence
// (WOS-YYYYMMDD-00001, 00002, ...) — NOT a secret. As of this fix,
// this route requires `?token=` (orders.payment_access_token, added
// in migration 021) alongside order_number, same boundary already
// enforced correctly by /payments and the /my-trip pages. Also only
// returns fields safe to show an unauthenticated visitor who does
// hold the right token. Deliberately excludes: notes (internal admin
// notes), cancelled_reason, attachment_url, patient_id, and the
// customer's phone/line_id/country — only full_name is returned, for
// a friendly greeting on the page.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';
import { loadAuthorizedOrder } from '@/lib/orders/authorize-order';

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

export async function GET(
  request: Request,
  { params }: { params: { orderNumber: string } }
) {
  const { orderNumber } = params;
  if (!orderNumber) {
    return NextResponse.json({ error: 'missing order number' }, { status: 400 });
  }

  // Loose rate limit — this is a read-only public page, but still worth
  // capping to slow down brute-force attempts against the token.
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const { allowed } = await simpleRateLimit(`quote-view:${ip}`, 30, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  const supabase = createServiceClient();

  const token = new URL(request.url).searchParams.get('token');
  const { order, error: authError } = await loadAuthorizedOrder(supabase, orderNumber, token);

if (authError) return authError;

if (!order) {
  return NextResponse.json(
    { error: 'order not found' },
    { status: 404 }
  );
}

  // 2. Order items
  const { data: items, error: itemsErr } = await supabase
  .from('order_items')
  .select('id, package_id, partner_id, service_type, price, needs_assignment, room_quantity, scheduled_date, scheduled_time, transport_mode, transport_return_date, transport_return_time, hotel_checkout_date, pickup_location, dropoff_location')
  .eq('order_id', order.id);

  if (itemsErr) {
    console.error('fetch order_items failed:', itemsErr);
    return NextResponse.json({ error: 'failed to load quote' }, { status: 500 });
  }

  // 3. Customer — first name only, for greeting (not phone/line/country)
  const { data: customer, error: customerErr } = await supabase
    .from('customers')
    .select('full_name')
    .eq('id', order!.patient_id)
    .single();

  if (customerErr) {
    console.error('fetch customer failed:', customerErr);
  }

  // 4. Packages + partners referenced by items
  const packageIds = [...new Set((items ?? []).map((i) => i.package_id).filter((v): v is string => !!v))];
  const partnerIds = [...new Set((items ?? []).map((i) => i.partner_id).filter((v): v is string => !!v))];

  const [packagesRes, partnersRes] = await Promise.all([
    packageIds.length
      ? supabase.from('packages').select('id, title, original_price, special_price').in('id', packageIds)
      : Promise.resolve({ data: [] as PackageRow[], error: null }),
    partnerIds.length
      ? supabase.from('partners').select('id, name').in('id', partnerIds)
      : Promise.resolve({ data: [] as PartnerRow[], error: null }),
  ]);

  const packageById = new Map((packagesRes.data ?? []).map((p) => [p.id, p]));
  const partnerById = new Map((partnersRes.data ?? []).map((p) => [p.id, p]));

  const enrichedItems = (items ?? []).map((item) => ({
    ...item,
    package: item.package_id ? packageById.get(item.package_id) ?? null : null,
    partner: item.partner_id ? partnerById.get(item.partner_id) ?? null : null,
  }));

  return NextResponse.json({
    order: {
      order_number: order!.order_number,
      status: order!.status,
      currency: order!.currency,
      total_amount: order!.total_amount,
      total_deposit_required: order!.total_deposit_required,
      total_deposit_paid: order!.total_deposit_paid,
      total_balance_remaining: order!.total_balance_remaining,
      created_at: order!.created_at,
      customer_name: customer?.full_name ?? null,
      items: enrichedItems,
    },
  });
}
