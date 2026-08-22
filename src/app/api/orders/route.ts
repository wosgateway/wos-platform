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
// UPDATED (with migration 021): also returns payment_access_token —
// order_number alone is a predictable sequence
// ('WOS-YYYYMMDD-00001', ...), not a secret, so the customer-facing
// /my-trip/[orderNumber] and /my-trip/[orderNumber]/payment pages
// require this token too. BookingForm.tsx uses it to build the link
// it shows the customer after a successful booking — see its
// "done" screen.
//
// UPDATED (with migration 036): create_order_with_items() now takes
// p_client_request_id and returns order_number/total_amount/
// total_deposit_required/currency/payment_access_token directly —
// no more separate SELECT after the RPC call. That SELECT used to
// be a real failure window: if it failed after the order had
// already been created, the customer was told to "refresh to
// retry", which created a SECOND order for the same booking. See
// migration 036's header for the full idempotency design.
//
// client_request_id is REQUIRED (not just accepted) as of this
// version — see validate() below. It was optional during the
// transition while BookingForm.tsx / JourneyBookingForm.tsx were
// being updated to generate one; both do now (see clientRequestIdRef
// in each), so an order created without one would have zero
// duplicate-booking protection (the DB partial unique index only
// applies WHERE client_request_id IS NOT NULL) — not something to
// allow silently on a public endpoint.
//
// SECURITY: rate-limited by IP and by phone (see simpleRateLimit
// calls in POST below) — same in-memory limiter already used by
// quote/[orderNumber]/payments/route.ts. IP alone isn't enough on a
// public unauthenticated endpoint (shared/rotating IPs, mobile
// carrier NAT), and phone alone isn't enough either (one attacker can
// cycle IPs), so both are checked. Still no CAPTCHA/Turnstile in
// front of BookingForm — worth adding if abuse shows up in practice,
// but the rate limit closes the "no cost to spam" gap for now.
//
// transport_pickup_location / transport_dropoff_location: forwarded
// to create_order_with_items() same as transport_mode etc. Requires
// migrations 024 (adds order_items.pickup_location/dropoff_location)
// and 025 (updates the function to read/store them) — run both
// before deploying this route, or the values are accepted here but
// silently dropped by the RPC.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { notifyNewOrder } from '@/lib/notify/order-notify';
import { simpleRateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/phone';

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
  // Hotel-only: number of rooms (migration 028). Multiplies into
  // price alongside quantity (nights) — see BookingForm.tsx's
  // priceBreakdown and create_order_with_items() for both sides of
  // that math. Only meaningful when this item is a hotel item; for
  // a package_id item that isn't hotel, or service_type='transport',
  // sending anything other than 1 (or omitting it) is rejected
  // inside create_order_with_items() since the DB is the only place
  // that reliably knows a resolved package's category.
  room_quantity?: number;
  hotel_checkout_date?: string;
  // Transport-only:
  transport_mode?: 'one_way' | 'round_trip' | 'daily' | 'medical_assistance';
  transport_return_date?: string;
  transport_return_time?: string;
  // Free text, already resolved client-side from the pickup/dropoff
  // dropdown (a fixed corridor point, or "hotel: <name>" / a custom
  // spot the customer typed) — see BookingForm.tsx / JourneyBookingForm.tsx
  // resolveLocationLabel(). Forwarded as-is; nothing here is used to
  // derive price or partner, so it doesn't need the same
  // never-trust-the-client treatment as package_id/price.
  transport_pickup_location?: string;
  transport_dropoff_location?: string;
  // Transport-only (migration 037). vehicle_type is free text
  // (intentionally not a fixed enum here — see the migration's
  // comment); passenger_count is validated as a positive integer
  // below. Both are rejected server-side (in create_order_with_items())
  // if sent on a non-transport item.
  vehicle_type?: string;
  passenger_count?: number;
}

interface CreateOrderBody {
  customer: CustomerInput;
  items: OrderItemInput[];
  notes?: string;
  attachment_url?: string;
  // UUID the browser generates once per booking attempt and re-sends
  // unchanged on any retry of that SAME attempt (network timeout,
  // double-tap, etc). See migration 036 — the DB treats a repeated
  // value as "same request, already handled" instead of creating a
  // second order. REQUIRED — validate() rejects any request missing
  // this, since an order created without one has no idempotency
  // protection at all (the DB unique index only applies WHERE
  // client_request_id IS NOT NULL). BookingForm.tsx /
  // JourneyBookingForm.tsx always send one; kept as `string` (not
  // optional) here because the type should reflect the enforced
  // contract, not the historical transition period.
  client_request_id: string;
}

// Ceiling on items per order — not a real business limit (no booking
// realistically needs more), just a cheap reject-early guard so a
// malformed/abusive payload (thousands of empty item objects) doesn't
// burn JSON-parse/validation/RPC-mapping work before the DB would
// reject it anyway. Bump if a legitimate multi-item booking ever
// needs more.
const MAX_ITEMS = 20;

// Same reasoning as MAX_ITEMS: a booking with more than this many
// nights/rooms/units in a single item is far more likely to be
// malformed or abusive input than a real booking.
const MAX_QUANTITY = 100;

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
  if (body.items.length > MAX_ITEMS) {
    return `items must contain no more than ${MAX_ITEMS} items`;
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
    // Integer + capped, same treatment as room_quantity below — this
    // represents a count of nights/units, never a fractional amount
    // (previously any positive number, e.g. 0.5, was accepted).
    if (
      item.quantity !== undefined &&
      (typeof item.quantity !== 'number' ||
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0 ||
        item.quantity > MAX_QUANTITY)
    ) {
      return `item[${i}]: quantity must be a whole number between 1 and ${MAX_QUANTITY}`;
    }
    if (
      item.room_quantity !== undefined &&
      (typeof item.room_quantity !== 'number' ||
        !Number.isInteger(item.room_quantity) ||
        item.room_quantity <= 0 ||
        item.room_quantity > MAX_QUANTITY)
    ) {
      return `item[${i}]: room_quantity must be a whole number between 1 and ${MAX_QUANTITY}`;
    }
    // Only enforceable here for the "let team decide" shape, where
    // service_type is given directly. A package_id item's real
    // category (and therefore whether it's actually 'hotel') is only
    // known inside create_order_with_items() — that's the backstop
    // for tampered requests; this is just an earlier, friendlier
    // rejection for the common case.
    if (
      item.room_quantity !== undefined &&
      item.room_quantity !== 1 &&
      hasServiceType &&
      item.service_type !== 'hotel'
    ) {
      return `item[${i}]: room_quantity is only supported for hotel items`;
    }
    if (
      item.transport_mode !== undefined &&
      !['one_way', 'round_trip', 'daily', 'medical_assistance'].includes(item.transport_mode)
    ) {
      return `item[${i}]: transport_mode must be one_way, round_trip, daily, or medical_assistance`;
    }
    if (
      item.passenger_count !== undefined &&
      (typeof item.passenger_count !== 'number' ||
        !Number.isInteger(item.passenger_count) ||
        item.passenger_count <= 0)
    ) {
      return `item[${i}]: passenger_count must be a positive whole number`;
    }
  }
  if (body.attachment_url != null) {
    // Loose (!=) check on purpose: BookingForm.tsx/JourneyBookingForm.tsx
    // send `attachment_url: null` (not omitted) when there's no file, and
    // null !== undefined, so a strict check here rejected every
    // no-attachment booking. Treat null the same as "not provided".
    if (typeof body.attachment_url !== 'string' || !body.attachment_url) {
      return 'attachment_url must be a non-empty string';
    }
    // Must point at THIS project's own Supabase Storage — never trust
    // an arbitrary client-supplied URL. This is only stored/displayed
    // today (low risk), but if it's ever fetched/downloaded/processed
    // server-side later, an unrestricted URL here would be an SSRF
    // vector. Compare against the same env var the service client
    // itself is built from, so this can't drift out of sync with it.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // BookingForm.tsx / JourneyBookingForm.tsx always upload to the
    // 'booking-attachments' bucket and send back getPublicUrl()'s
    // result — anything else is not a URL our own upload step could
    // have produced.
    const expectedPrefix = supabaseUrl
      ? `${supabaseUrl}/storage/v1/object/public/booking-attachments/`
      : null;
    if (!expectedPrefix || !body.attachment_url.startsWith(expectedPrefix)) {
      return 'attachment_url must be a Supabase Storage URL from this project';
    }
  }
  if (body.client_request_id !== undefined) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof body.client_request_id !== 'string' || !uuidPattern.test(body.client_request_id)) {
      return 'client_request_id must be a valid UUID';
    }
  } else {
    // client_request_id used to be optional here for backward
    // compatibility while BookingForm.tsx / JourneyBookingForm.tsx
    // were being updated to always send one (migration 036). Both
    // now do — see clientRequestIdRef in each — so this is no longer
    // "trust the client to send it"; it's "reject the request if it
    // didn't". Without this, a caller (a stale client build, a
    // third-party integration, a manual curl) could silently create
    // NON-idempotent orders — no duplicate-booking protection at
    // all, not even the DB-level partial unique index, since that
    // index only applies WHERE client_request_id IS NOT NULL. Fail
    // loudly here instead of letting that gap exist quietly in
    // production.
    return 'client_request_id is required';
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

  const { customer, items, notes, attachment_url, client_request_id } = body as CreateOrderBody;
  // Canonicalize once, here, before it's used as an identity key
  // anywhere (rate-limit key, find_or_create_customer's lock/lookup
  // key) — see lib/phone.ts header for why this has to be the server,
  // not trusted from the client. Using the SAME normalized value for
  // both the rate limit and the RPC call also means a customer who
  // types "081-234-5678" then retries as "0812345678" gets rate-
  // limited as one identity, not two.
  const phone = normalizePhone(customer.phone);
  if (!phone) {
    return NextResponse.json({ error: 'customer.phone is required' }, { status: 400 });
  }

  // --- Rate limit: by IP and by phone, independently. ---
  // IP alone isn't enough (shared/rotating IPs), phone alone isn't
  // enough (attacker can vary the phone per request) — both must
  // pass. Deliberately checked before any DB write.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipLimit = simpleRateLimit(`order-create:ip:${ip}`, 10, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: 'too many requests, please try again later' }, { status: 429 });
  }
  const phoneLimit = simpleRateLimit(`order-create:phone:${phone}`, 5, 60 * 60 * 1000);
  if (!phoneLimit.allowed) {
    return NextResponse.json({ error: 'too many requests, please try again later' }, { status: 429 });
  }
  const supabase = createServiceClient();

  // --- Resolve customer: find by phone, create if none exists. ---
  // Race-safety against concurrent submissions from the same phone is
  // handled inside find_or_create_customer() (migration 034) via an
  // advisory lock keyed on the (already-normalized) phone — NOT a
  // unique constraint on customers.phone, which migration 011
  // deliberately omitted (a phone number isn't guaranteed to map 1:1
  // to a person). This keeps that business rule intact while still
  // closing both the concurrent-INSERT race and the "same number,
  // different formatting" identity gap.

  const { data: customerId, error: customerErr } = await supabase.rpc('find_or_create_customer', {
    p_phone: phone,
    p_full_name: customer.full_name.trim(),
    p_email: customer.email?.trim() || null,
    p_line_id: customer.line_id?.trim() || null,
    p_country: customer.country || null,
    p_preferred_language: customer.preferred_language || 'th',
  });

  if (customerErr || !customerId) {
  console.error('find_or_create_customer RPC failed:', {
    customerErr,
    customerId,
    phone,
    customer
  });

  return NextResponse.json(
    {
      error: 'failed to resolve customer',
      detail: customerErr?.message ?? 'no customer id returned'
    },
    { status: 500 }
  );
}

  // --- Create the order atomically via the DB function. ---
  // Only package_id/quantity/schedule are forwarded — price,
  // partner_id, and service_type are resolved inside the function
  // from packages/partners, never from this request body.
  const rpcItems = items.map((item) => {
    const base: Record<string, unknown> = {
      quantity: item.quantity ?? 1,
      room_quantity: item.room_quantity ?? 1,
      scheduled_date: item.scheduled_date ?? null,
      scheduled_time: item.scheduled_time ?? null,
      hotel_checkout_date: item.hotel_checkout_date ?? null,
      transport_mode: item.transport_mode ?? null,
      transport_return_date: item.transport_return_date ?? null,
      transport_return_time: item.transport_return_time ?? null,
      transport_pickup_location: item.transport_pickup_location ?? null,
      transport_dropoff_location: item.transport_dropoff_location ?? null,
      vehicle_type: item.vehicle_type ?? null,
      passenger_count: item.passenger_count ?? null,
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
    p_client_request_id: client_request_id,
  });

  if (error) {
    console.error('create_order_with_items RPC failed:', error);
    // Unknown/unpublished package, missing deposit rule, etc. all
    // raise from inside the function with a descriptive message —
    // surface those as 400 since they're almost always a bad
    // request, not a server fault. Anything else is a server error.
    const isClientError = /unknown |unpublished|requires |no active deposit_rule|must have at least one item|quantity must be positive|no service_type mapping|let team decide|room_quantity/.test(
      error.message ?? ''
    );
    return NextResponse.json(
      { error: isClientError ? error.message : 'failed to create order' },
      { status: isClientError ? 400 : 500 }
    );
  }

  // order_number/total_amount/total_deposit_required/currency/
  // payment_access_token all come back directly from the RPC now
  // (migration 036) — no separate SELECT round trip after this,
  // which is what used to leave a window where the order existed
  // but its totals failed to load, prompting a "refresh to retry"
  // that could create a second order. idempotent_replay=true means
  // this exact client_request_id already succeeded before; this is
  // that same order being handed back, not a new one.
  if (data.idempotent_replay) {
    console.log('create_order_with_items: idempotent replay', {
      orderId: data.order_id,
      orderNumber: data.order_number,
      clientRequestId: client_request_id,
    });
  }

  // --- Fire the instant Admin notification (LINE/Telegram/webhook). ---
  // Skip entirely on a replay — the admin was already notified when
  // this order was first created; re-sending would just be noise (or
  // worse, look like a second real booking) for what's actually the
  // same request retried.
  //
  // Best-effort and non-blocking to the *customer* (they already have
  // their order_number either way), but we do await it here rather
  // than truly fire-and-forget — on serverless (Vercel) an un-awaited
  // promise can get killed the instant this function returns its
  // response, so an un-awaited call here would silently never fire.
  // notifyNewOrder() itself never throws, so this can't turn into a
  // 500 for the customer even if every channel is down.
  if (!data.idempotent_replay) {
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
        orderNumber: data.order_number,
        customerName: customer.full_name.trim(),
        customerPhone: phone,
        totalAmount: data.total_amount,
        totalDepositRequired: data.total_deposit_required,
        currency: data.currency,
        items: notifyItems,
      });
    } catch (notifyErr) {
      // Belt-and-suspenders — notifyNewOrder() already swallows its own
      // per-channel errors, but never let ANY notification issue affect
      // the customer-facing response.
      console.error('order notification dispatch failed:', notifyErr);
    }
  }

  return NextResponse.json(
    {
      order_number: data.order_number,
      total_amount: data.total_amount,
      total_deposit_required: data.total_deposit_required,
      currency: data.currency,
      payment_access_token: data.payment_access_token,
    },
    { status: 201 }
  );
}
