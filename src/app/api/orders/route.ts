// app/api/orders/route.ts
//
// Public endpoint (no customer auth yet — see migration 008 note).
// The browser never knows a customer id, so this route accepts raw
// contact info (matching BookingForm.tsx step 2: name/phone/line/
// country), resolves it to a `customers` row (find by phone, create
// if none exists — migration 011), then creates the order via
// create_order_with_items() (migration 012, extended by 013/014).
//
// Each item carries EITHER package_id (a specific package the
// customer chose) OR service_type ('hotel' | 'transport' only) when
// the customer left the partner for the team to decide — see
// migration 013/014 for how "let team decide" rows are stored.
// price, partner_id, and service_type (for resolved items) are ALL
// resolved server-side from packages/partners inside the DB
// function — never trust those from the client, or a tampered
// request could pay less than the real price or claim a cheaper
// service category's deposit rate.
//
// attachment_url is uploaded client-side to Supabase Storage first
// (see BookingForm.tsx) and only the resulting URL is sent here.
//
// TODO before this goes live for real traffic: no rate-limiting or
// captcha yet. This is a public unauthenticated endpoint that can
// create rows in `customers`/`orders`/`order_items` — worth putting
// behind something (e.g. Vercel/Upstash rate limit by IP, or a
// lightweight turnstile/captcha on the BookingForm) before launch.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { notifyNewOrder } from '@/lib/notify/order-notify';

interface CustomerInput {
  full_name: string;
  phone: string;
  email?: string;
  line_id?: string;
  country?: string;
  preferred_language?: string;
}

interface OrderItemInput {
  // Exactly one of package_id / service_type must be present.
  // package_id: a specific package the customer chose.
  // service_type: 'hotel' | 'transport' only — customer left the
  //   partner unpicked ("let team decide"); an admin assigns the
  //   real package/partner/price later (see migration 013/014).
  package_id?: string;
  service_type?: 'hotel' | 'transport';
  quantity?: number;
  scheduled_date?: string;
  scheduled_time?: string;
  // Hotel-only:
  hotel_checkout_date?: string;
  // Transport-only:
  transport_mode?: 'one_way' | 'round_trip' | 'daily';
  transport_return_date?: string;
  transport_return_time?: string;
}

interface CreateOrderBody {
  customer: CustomerInput;
  items: OrderItemInput[];
  notes?: string;
  attachment_url?: string;
}

function validate(body: Partial<CreateOrderBody>): string | null {
  if (!body.customer || typeof body.customer !== 'object') {
    return 'customer is required';
  }
  if (!body.customer.full_name?.trim()) {
    return 'customer.full_name is required';
  }
  if (!body.customer.phone?.trim()) {
    return 'customer.phone is required';
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return 'items must be a non-empty array';
  }
  for (const [i, item] of body.items.entries()) {
    const hasPackage = typeof item.package_id === 'string' && item.package_id.length > 0;
    const hasServiceType = typeof item.service_type === 'string' && item.service_type.length > 0;

    if (!hasPackage && !hasServiceType) {
      return `item[${i}]: requires either package_id or service_type`;
    }
    if (hasPackage && hasServiceType) {
      return `item[${i}]: provide package_id OR service_type, not both`;
    }
    if (hasServiceType && item.service_type !== 'hotel' && item.service_type !== 'transport') {
      return `item[${i}]: service_type (let-team-decide) only supports 'hotel' or 'transport'`;
    }
    if (item.quantity !== undefined && (typeof item.quantity !== 'number' || item.quantity <= 0)) {
      return `item[${i}]: quantity must be a positive number`;
    }
    if (
      item.transport_mode !== undefined &&
      !['one_way', 'round_trip', 'daily'].includes(item.transport_mode)
    ) {
      return `item[${i}]: transport_mode must be one_way, round_trip, or daily`;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: Partial<CreateOrderBody>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const validationError = validate(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { customer, items, notes, attachment_url } = body as CreateOrderBody;
  const supabase = createServiceClient();

  // --- Resolve customer: find by phone, create if none exists. ---
  // Not race-safe against two simultaneous submissions from the same
  // phone number (no unique constraint on customers.phone — see
  // migration 011 for why). Acceptable for now; revisit if duplicate
  // customers become a real problem.
  const phone = customer.phone.trim();

  const { data: existing, error: findErr } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();

  if (findErr) {
    console.error('customer lookup failed:', findErr);
    return NextResponse.json({ error: 'failed to look up customer' }, { status: 500 });
  }

  let customerId: string;
  if (existing) {
    customerId = existing.id;
  } else {
    const { data: created, error: createErr } = await supabase
      .from('customers')
      .insert({
        full_name: customer.full_name.trim(),
        phone,
        email: customer.email?.trim() || null,
        line_id: customer.line_id?.trim() || null,
        country: customer.country || null,
        preferred_language: customer.preferred_language || 'th',
      })
      .select('id')
      .single();

    if (createErr || !created) {
      console.error('customer creation failed:', createErr);
      return NextResponse.json({ error: 'failed to create customer' }, { status: 500 });
    }
    customerId = created.id;
  }

  // --- Create the order atomically via the DB function. ---
  // Only package_id/quantity/schedule are forwarded — price,
  // partner_id, and service_type are resolved inside the function
  // from packages/partners, never from this request body.
  const rpcItems = items.map((item) => {
    const base: Record<string, unknown> = {
      quantity: item.quantity ?? 1,
      scheduled_date: item.scheduled_date ?? null,
      scheduled_time: item.scheduled_time ?? null,
      hotel_checkout_date: item.hotel_checkout_date ?? null,
      transport_mode: item.transport_mode ?? null,
      transport_return_date: item.transport_return_date ?? null,
      transport_return_time: item.transport_return_time ?? null,
    };
    // Only one of these keys should be present — the DB function
    // branches on whether "package_id" exists in the JSON at all,
    // not on it being null, so we must omit rather than null it out.
    if (item.package_id) {
      base.package_id = item.package_id;
    } else {
      base.service_type = item.service_type;
    }
    return base;
  });

  const { data, error } = await supabase.rpc('create_order_with_items', {
    p_patient_id: customerId,
    p_items: rpcItems,
    p_notes: notes ?? null,
    p_attachment_url: attachment_url ?? null,
  });

  if (error) {
    console.error('create_order_with_items RPC failed:', error);
    // Unknown/unpublished package, missing deposit rule, etc. all
    // raise from inside the function with a descriptive message —
    // surface those as 400 since they're almost always a bad
    // request, not a server fault. Anything else is a server error.
    const isClientError = /unknown |unpublished|requires |no active deposit_rule|must have at least one item|quantity must be positive|no service_type mapping|let team decide/.test(
      error.message ?? ''
    );
    return NextResponse.json(
      { error: isClientError ? error.message : 'failed to create order' },
      { status: isClientError ? 400 : 500 }
    );
  }

  const { data: order, error: fetchErr } = await supabase
    .from('orders')
    .select('order_number, total_amount, total_deposit_required, currency')
    .eq('id', data.order_id)
    .single();

  if (fetchErr || !order) {
    console.error('order created but totals fetch failed:', fetchErr);
    // Order (and customer) did get created — don't claim total
    // failure, but we can't hand back deposit amounts for the
    // payment screen.
    return NextResponse.json(
      { order_number: data.order_number, error: 'order created, failed to load totals — refresh to retry' },
      { status: 207 }
    );
  }

  // --- Fire the instant Admin notification (LINE/Telegram/webhook). ---
  // Best-effort and non-blocking to the *customer* (they already have
  // their order_number either way), but we do await it here rather
  // than truly fire-and-forget — on serverless (Vercel) an un-awaited
  // promise can get killed the instant this function returns its
  // response, so an un-awaited call here would silently never fire.
  // notifyNewOrder() itself never throws, so this can't turn into a
  // 500 for the customer even if every channel is down.
  try {
    // order_items has no admin-readable RLS policy (see
    // BookingsManager.tsx comment) — must read via the service-role
    // client, which we already have in scope here.
    const { data: orderItems, error: itemsErr } = await supabase
      .from('order_items')
      .select('service_type, scheduled_date, needs_assignment, package:packages(title), partner:partners(name)')
      .eq('order_id', data.order_id);

    if (itemsErr) {
      console.error('failed to load order_items for notification:', itemsErr);
    }

    const notifyItems = (orderItems ?? []).map((item) => {
      const packageTitle = item.package?.[0]?.title as string | undefined;
      const partnerName = item.partner?.[0]?.name as string | undefined;
      const label = item.needs_assignment
        ? `${item.service_type === 'hotel' ? '🏨' : '🚗'} ${item.service_type} (ให้ทีมงานจัด)`
        : [packageTitle, partnerName].filter(Boolean).join(' — ') || item.service_type;
      return { label, scheduledDate: item.scheduled_date as string | null };
    });

    await notifyNewOrder({
      orderId: data.order_id,
      orderNumber: order.order_number,
      customerName: customer.full_name.trim(),
      customerPhone: phone,
      totalAmount: order.total_amount,
      totalDepositRequired: order.total_deposit_required,
      currency: order.currency,
      items: notifyItems,
    });
  } catch (notifyErr) {
    // Belt-and-suspenders — notifyNewOrder() already swallows its own
    // per-channel errors, but never let ANY notification issue affect
    // the customer-facing response.
    console.error('order notification dispatch failed:', notifyErr);
  }

  return NextResponse.json(
    {
      order_number: order.order_number,
      total_amount: order.total_amount,
      total_deposit_required: order.total_deposit_required,
      currency: order.currency,
    },
    { status: 201 }
  );
}
