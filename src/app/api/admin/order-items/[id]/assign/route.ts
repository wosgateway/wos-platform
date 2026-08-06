// app/api/admin/order-items/[id]/assign/route.ts
//
// Assigns a real package (and therefore partner/price/deposit) to a
// needs_assignment order_items row. Admin session is verified here
// in Next.js; the actual price/deposit derivation happens inside
// admin_assign_order_item() (migration 016) using the service-role
// client, the same division of responsibility as /api/orders.

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
  const { data, error } = await supabase.rpc('admin_assign_order_item', {
    p_order_item_id: id,
    p_package_id: body.package_id,
    p_quantity: body.quantity ?? 1,
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
