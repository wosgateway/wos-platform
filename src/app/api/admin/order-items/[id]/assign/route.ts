// app/api/admin/order-items/[id]/assign/route.ts
//
// Assigns a real package (and therefore partner/price/deposit) to a
// needs_assignment order_items row. Admin session is verified here
// in Next.js; the actual price/deposit derivation happens inside
// admin_assign_order_item() (migration 016) using the service-role
// client, the same division of responsibility as /api/orders.
//
// room_quantity (migration 028, then 040/056): body.quantity is
// nights-for-hotel / days-for-transport only, entered by the admin
// on the pending-assignments/BookingsManager screens — it must NEVER
// include room_quantity. room_quantity itself was already fixed at
// booking time (Branch A of create_order_with_items(), migration 028)
// and lives on the order_items row; admin_assign_order_item() reads
// it server-side and multiplies it into price internally (v_price =
// unit_price × p_quantity × room_quantity, see migration 040/056/057).
// route.ts must pass p_quantity = nights/days as-is and NOT also
// multiply by room_quantity here — doing so double-counts it
// (price ends up × room_quantity² instead of × room_quantity). This
// file used to fetch room_quantity and fold it in; migration 056
// fixed the RPC side of this bug but the route.ts side was never
// updated to match — fixed here.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';
import {
  getCustomerContactByOrderItemId,
  notifyPartnerAssigned,
} from '@/lib/notify/customer-whatsapp';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;

  let body: { package_id?: string; quantity?: number };
  try {
    body = await req.json();
  } catch {
    return withRefreshedCookies(
      NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }),
      cookieCarrier
    );
  }

  if (!body.package_id || typeof body.package_id !== 'string') {
    return withRefreshedCookies(
      NextResponse.json({ error: 'package_id is required' }, { status: 400 }),
      cookieCarrier
    );
  }
  if (body.quantity !== undefined && (typeof body.quantity !== 'number' || body.quantity <= 0)) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'quantity must be a positive number' }, { status: 400 }),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  // p_quantity = nights (hotel) / days (transport) as entered by the
  // admin, unmodified. Do NOT fold room_quantity in here — the RPC
  // already multiplies by room_quantity internally (see file header).
  const { data, error } = await supabase.rpc('admin_assign_order_item', {
    p_order_item_id: id,
    p_package_id: body.package_id,
    p_quantity: body.quantity ?? 1,
  });

  if (error) {
    console.error('admin_assign_order_item RPC failed:', error);

    const message = error.message ?? '';

    // Business-state conflicts: the DB correctly refuses changes to
    // confirmed/completed orders. These are conflicts, not server errors.
    const isConflict =
      /parent order status is (confirmed|completed)/i.test(message);

    const isClientError =
      /not found|already assigned|category mismatch|unpublished|no active deposit_rule|quantity must be positive/i.test(
        message
      );

    const status = isConflict ? 409 : isClientError ? 400 : 500;

    return withRefreshedCookies(
      NextResponse.json(
        {
          error: message || 'failed to assign',
        },
        { status }
      ),
      cookieCarrier
    );
  }

  // PHASE 4 — one-way WhatsApp notify ("driver assigned" in the plan's
  // wording, generalized here since assignment applies to any
  // needs_assignment service_type, not just transport). Deliberately
  // NOT awaited — see customer-whatsapp.ts header.
  void getCustomerContactByOrderItemId(supabase, id).then((contact) => {
    if (contact) void notifyPartnerAssigned(contact);
  });

  return withRefreshedCookies(NextResponse.json(data), cookieCarrier);
}