// app/api/admin/order-items/[id]/assign/route.ts
//
// Assigns a real package (and therefore partner/price/deposit) to a
// needs_assignment order_items row. Admin session is verified here
// in Next.js; the actual price/deposit derivation happens inside
// admin_assign_order_item() (migration 016) using the service-role
// client, the same division of responsibility as /api/orders.
//
// room_quantity (migration 028): admin_assign_order_item() has no
// room_quantity parameter of its own — its signature is
// (UUID, UUID, NUMERIC) and body.quantity is nights-for-hotel /
// days-for-transport, entered by the admin on the pending-assignments
// screen. room_quantity, however, was already fixed at booking time
// (Branch A of create_order_with_items(), migration 028) and lives on
// this order_items row — it must NOT be re-entered by the admin here,
// since that would let a client-supplied value override what the
// customer actually paid for. So: fetch it server-side from the row
// itself, and fold it into the p_quantity sent to the RPC —
// p_quantity = nights (from the admin) × room_quantity (from the
// row) — rather than changing the RPC's signature. For transport
// items room_quantity is always 1 (enforced in create_order_with_items()),
// so this is a no-op multiply for that service_type.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { createServiceClient } from '@/lib/supabase/service';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await params;

  let body: { package_id?: string; quantity?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.package_id || typeof body.package_id !== 'string') {
    return NextResponse.json({ error: 'package_id is required' }, { status: 400 });
  }
  if (body.quantity !== undefined && (typeof body.quantity !== 'number' || body.quantity <= 0)) {
    return NextResponse.json({ error: 'quantity must be a positive number' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Fetch room_quantity off the row itself — never trust a client-
  // supplied value for anything that multiplies into price. See file
  // header for why this can't just be a new RPC parameter supplied
  // by the request body instead.
  const { data: row, error: rowErr } = await supabase
    .from('order_items')
    .select('room_quantity')
    .eq('id', id)
    .single();

  if (rowErr || !row) {
    console.error('order_items lookup failed before assign:', rowErr);
    return NextResponse.json({ error: 'order item not found' }, { status: 404 });
  }

  const nightsOrDays = body.quantity ?? 1;
  const roomQuantity = row.room_quantity ?? 1;
  const combinedQuantity = nightsOrDays * roomQuantity;

  const { data, error } = await supabase.rpc('admin_assign_order_item', {
    p_order_item_id: id,
    p_package_id: body.package_id,
    p_quantity: combinedQuantity,
  });

  if (error) {
    console.error('admin_assign_order_item RPC failed:', error);
    const isClientError = /not found|already assigned|category mismatch|unpublished|no active deposit_rule|quantity must be positive/.test(
      error.message ?? ''
    );
    return NextResponse.json(
      { error: isClientError ? error.message : 'failed to assign' },
      { status: isClientError ? 400 : 500 }
    );
  }
  return NextResponse.json(data);
}