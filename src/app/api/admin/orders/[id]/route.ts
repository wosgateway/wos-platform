// app/api/admin/orders/[id]/route.ts
//
// Updates an order's status. Item-level reassignment (hotel/transport
// package_id/quantity) stays on the existing
// /api/admin/order-items/[id]/assign endpoint — this route only
// touches the order row itself, to keep the two concerns separate.
//
// ALLOWED_STATUSES kept identical to the old bookings.status
// vocabulary. If migration 008 defines a different enum, update this
// list and the one in ../route.ts together.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { createServiceClient } from '@/lib/supabase/service';

// Matches the CHECK constraint on public.orders.status from migration 008
// (chk_order_status) exactly — do not add/remove values here without also
// updating that constraint.
const ALLOWED_STATUSES = [
  'draft',
  'pending_deposit',
  'deposit_paid',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'refunded',
] as const;
type OrderStatus = (typeof ALLOWED_STATUSES)[number];

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const status = body?.status as OrderStatus | undefined;

  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('orders').update({ status }).eq('id', params.id);

  if (error) {
    console.error('update order status failed:', error);
    return NextResponse.json({ error: 'failed to update status' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
