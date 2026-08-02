// src/app/api/partner/payments/[id]/verify/route.ts
//
// POST /api/partner/payments/:id/verify
//
// Marks a payment as verified and rolls the amount into the parent
// order_item's deposit_paid. Deliberately NOT exposed via RLS (see
// migration 008 comments) — this route is the only place partner staff
// can write to `payments`, so validation/role checks/audit fields live
// here in one spot instead of being re-implemented per client call.

import { NextResponse } from 'next/server';
import { getPartnerSession, hasPermission } from '@/lib/partner/auth';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  // 1. Auth — must be a logged-in partner user with permission to
  //    manage payments. Admins always pass; staff need the explicit
  //    permission (add 'manage_payments' to a user's permissions array
  //    in Supabase if a non-admin should be allowed to verify slips).
  const { user } = await getPartnerSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasPermission(user, 'manage_payments')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const paymentId = params.id;

  // 2. Load the payment scoped to the user's own organization. We use
  //    the normal (RLS-enforced) client here on purpose: the SELECT
  //    policy on `payments` already restricts rows to order_items whose
  //    organization_id matches the caller's org, so a payment belonging
  //    to another partner simply won't be returned — defense in depth
  //    on top of the permission check above.
  const supabase = createClient();
  const { data: payment, error: fetchError } = await supabase
    .from('payments')
    .select(
      `
      id,
      order_id,
      order_item_id,
      amount,
      currency,
      status,
      order_items (
        id,
        organization_id,
        price,
        deposit_required,
        deposit_paid
      )
    `
    )
    .eq('id', paymentId)
    .single();

  if (fetchError || !payment) {
    // Either it doesn't exist, or RLS hid it because it belongs to a
    // different org — same response either way so we don't leak which.
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  const orderItem = Array.isArray(payment.order_items)
    ? payment.order_items[0]
    : payment.order_items;

  if (!orderItem) {
    // Whole-order payments (order_item_id IS NULL) aren't scoped to a
    // single partner and currently aren't visible to partner staff at
    // all (the RLS SELECT policy only matches order_item-linked rows).
    // Handle those from the admin/service-role side instead.
    return NextResponse.json(
      { error: 'This payment is not tied to a single order item and cannot be verified here.' },
      { status: 400 }
    );
  }

  if (payment.status !== 'waiting_verification' && payment.status !== 'pending') {
    return NextResponse.json(
      { error: `Payment is already "${payment.status}" and cannot be re-verified.` },
      { status: 409 }
    );
  }

  // 3. Sanity-check the amount against what's still owed. Doesn't hard
  //    block on mismatch (partial/overpayments happen in real life) but
  //    flags anything that looks wrong so the UI can warn before/while
  //    confirming, rather than silently accepting typos from a slip.
  const remainingBeforeThis = Number(orderItem.price) - Number(orderItem.deposit_paid);
  const amountLooksOff = Number(payment.amount) > remainingBeforeThis + 0.01;

  const body = await request.json().catch(() => ({}));
  if (amountLooksOff && !body.confirmOverpayment) {
    return NextResponse.json(
      {
        error: 'amount_exceeds_balance',
        message: `Payment amount (${payment.amount}) exceeds the remaining balance (${remainingBeforeThis}). Resubmit with { "confirmOverpayment": true } to proceed anyway.`,
        remainingBeforeThis,
      },
      { status: 409 }
    );
  }

  // 4. Write via the service-role client — this is the one place that's
  //    allowed to bypass RLS on `payments` / `order_items`.
  const service = createServiceClient();

  const { error: updatePaymentError } = await service
    .from('payments')
    .update({
      status: 'verified',
      verified_by: user.id,
      verified_at: new Date().toISOString(),
    })
    .eq('id', paymentId);

  if (updatePaymentError) {
    return NextResponse.json({ error: updatePaymentError.message }, { status: 500 });
  }

  const newDepositPaid = Number(orderItem.deposit_paid) + Number(payment.amount);

  const { error: updateItemError } = await service
    .from('order_items')
    .update({ deposit_paid: newDepositPaid })
    // sync_order_item_balance trigger recalculates balance_remaining,
    // and sync_order_totals then rolls everything up into `orders`.
    .eq('id', orderItem.id);

  if (updateItemError) {
    return NextResponse.json({ error: updateItemError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, paymentId, orderItemId: orderItem.id, newDepositPaid });
}
