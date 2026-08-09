// app/api/admin/payments/[id]/verify/route.ts
//
// Admin-side counterpart to /api/partner/payments/[id]/verify. That
// route deliberately refuses to touch whole-order payments
// (order_item_id IS NULL) because they aren't scoped to a single
// partner. Every payment created by the customer-facing
// Payment/Upload-Slip page (/api/quote/[orderNumber]/payments) is a
// whole-order payment, so admin needs its own verify/reject pair.
//
// The actual status transition + order balance update is delegated to
// the `admin_verify_payment` Postgres function (migration 022). That
// function does the claim (UPDATE ... WHERE status IN (...)), the
// `SELECT ... FOR UPDATE` row lock on the order, and the
// total_deposit_paid/status update all inside one transaction — so
// either everything commits together or nothing does, and two
// DIFFERENT payments on the same order verified at the same instant
// serialize on the order row lock instead of racing on
// total_deposit_paid (the residual race flagged in review).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const paymentId = params.id;
  const supabase = createServiceClient();

  // Pre-check purely for a clearer error message. The RPC itself also
  // refuses partner-scoped payments (WHERE order_item_id IS NULL), but
  // "payment_not_claimable" alone wouldn't tell the admin why.
  const { data: payment, error: fetchErr } = await supabase
    .from('payments')
    .select('id, order_item_id')
    .eq('id', paymentId)
    .single();

  if (fetchErr || !payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  if (payment.order_item_id) {
    return NextResponse.json(
      { error: 'This payment is tied to a single order item — verify it from the partner portal instead.' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc('admin_verify_payment', {
    p_payment_id: paymentId,
    p_admin_id: auth.user.id,
  });

  if (error) {
    if (error.message.includes('payment_not_claimable')) {
      return NextResponse.json(
        { error: 'Payment is already verified/rejected (or was just handled) and cannot be re-verified.' },
        { status: 409 }
      );
    }
    if (error.message.includes('order_not_found')) {
      return NextResponse.json({ error: 'Order not found for this payment' }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...data });
}
