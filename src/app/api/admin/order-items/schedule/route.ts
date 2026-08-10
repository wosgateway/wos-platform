// app/api/admin/order-items/[id]/schedule/route.ts
//
// Lets an admin correct the transport pickup/return date-time and
// hotel check-in/checkout date-time (plus pickup/dropoff location,
// migration 024) on a hotel/transport order_items row, after partner
// confirmation but before the quotation is printed/sent.
//
// Same division of responsibility as
// /api/admin/order-items/[id]/assign/route.ts: admin session is
// verified here in Next.js; the service_type/status/order-status
// guards and the audit-log write happen inside
// admin_update_order_item_schedule() (migration 026) via the
// service-role client.
//
// This is a distinct endpoint from /assign on purpose — assign
// changes WHICH package/partner an item points to (price/deposit
// implications), this only corrects scheduling details on an item
// that's already resolved.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { createServiceClient } from '@/lib/supabase/service';

interface ScheduleBody {
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  hotel_checkout_date?: string | null;
  transport_return_date?: string | null;
  transport_return_time?: string | null;
  pickup_location?: string | null;
  dropoff_location?: string | null;
}

// Basic YYYY-MM-DD / HH:MM[:SS] shape checks — real validity (e.g.
// Feb 30) is left to Postgres's DATE/TIME cast inside the RPC, which
// will raise a clear error we pass back as a 400 below.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function isNullableString(v: unknown): v is string | null | undefined {
  return v === undefined || v === null || typeof v === 'string';
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await params;

  let body: ScheduleBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // The RPC overwrites all 7 columns every call (see migration 026
  // header) — the admin edit form is expected to submit the full
  // current state, pre-filled, not a sparse patch. We still accept
  // missing keys here and treat them as null (= "clear this field")
  // rather than 400ing, so a form that omits an inapplicable field
  // (e.g. hotel_checkout_date on a transport item) doesn't need to
  // send an explicit null.
  for (const [key, value] of Object.entries(body)) {
    if (!isNullableString(value)) {
      return NextResponse.json({ error: `${key} must be a string or null` }, { status: 400 });
    }
  }

  if (body.scheduled_date && !DATE_RE.test(body.scheduled_date)) {
    return NextResponse.json({ error: 'scheduled_date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (body.hotel_checkout_date && !DATE_RE.test(body.hotel_checkout_date)) {
    return NextResponse.json({ error: 'hotel_checkout_date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (body.transport_return_date && !DATE_RE.test(body.transport_return_date)) {
    return NextResponse.json({ error: 'transport_return_date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (body.scheduled_time && !TIME_RE.test(body.scheduled_time)) {
    return NextResponse.json({ error: 'scheduled_time must be HH:MM[:SS]' }, { status: 400 });
  }
  if (body.transport_return_time && !TIME_RE.test(body.transport_return_time)) {
    return NextResponse.json({ error: 'transport_return_time must be HH:MM[:SS]' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('admin_update_order_item_schedule', {
    p_order_item_id: id,
    p_admin_id: auth.user.id,
    p_scheduled_date: body.scheduled_date ?? null,
    p_scheduled_time: body.scheduled_time ?? null,
    p_hotel_checkout_date: body.hotel_checkout_date ?? null,
    p_transport_return_date: body.transport_return_date ?? null,
    p_transport_return_time: body.transport_return_time ?? null,
    p_pickup_location: body.pickup_location ?? null,
    p_dropoff_location: body.dropoff_location ?? null,
  });

  if (error) {
    console.error('admin_update_order_item_schedule RPC failed:', error);
    const isClientError = /not found|only supported for hotel\/transport|item status is|schedule is locked once confirmed/.test(
      error.message ?? ''
    );
    return NextResponse.json(
      { error: isClientError ? error.message : 'failed to update schedule' },
      { status: isClientError ? 400 : 500 }
    );
  }

  return NextResponse.json(data);
}
