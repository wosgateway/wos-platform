// src/app/api/partner/payments/[id]/verify/route.ts
//
// POST /api/partner/payments/:id/verify
//
// Marks a payment as verified and rolls the amount into the parent
// order_item's deposit_paid. Deliberately NOT exposed via RLS (see
// migration 008 comments) — this route is the only place partner staff
// can write to `payments`, so validation/role checks/audit fields live
// here in one spot instead of being re-implemented per client call.
//
// The claim (status -> verified) + amount validation + deposit_paid
// update all happen inside `partner_verify_payment` (migration 022),
// a single Postgres function. That closes the race that existed here
// before: this route used to SELECT the payment, check its status in
// JS, then UPDATE separately — two DIFFERENT partner requests hitting
// verify on the same payment at (almost) the same instant could both
// pass the JS check and both add the amount to deposit_paid. The RPC's
// UPDATE ... WHERE status IN (...) claim + SELECT ... FOR UPDATE lock
// on the order_item row make that impossible: only one caller can win
// the claim, and a second payment on the same item verified
// concurrently serializes on the row lock instead of racing.

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

  // 2. Ownership check via the RLS-enforced client, on purpose: the
  //    SELECT policy on `payments` already restricts rows to
  //    order_items whose organization_id matches the caller's org, so
  //    a payment belonging to another partner simply won't be
  //    returned — defense in depth on top of the permission check
  //    above. Also used here to build a friendlier "amount exceeds
  //    balance" message before calling the RPC (the RPC is still the
  //    authoritative check — this is display only).
  const supabase = createClient();
  const { data: payment, error: fetchError } = await supabase
    .from('payments')
    .select(
      `
      id,
      order_item_id,
      amount,
      order_items (
        id,
        price,
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

  const orderItem = Array.isArray(payment.order_items) ? payment.order_items[0] : payment.order_items;

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

  const body = await request.json().catch(() => ({}));
  const confirmOverpayment = body?.confirmOverpayment === true;

  // 3. Claim + validate + write, atomically, via the RPC.
  const service = createServiceClient();
  const { data, error } = await service.rpc('partner_verify_payment', {
    p_payment_id: paymentId,
    p_partner_id: user.id,
    p_confirm_overpayment: confirmOverpayment,
  });

  if (error) {
    if (error.message.includes('payment_not_claimable')) {
      return NextResponse.json(
        { error: 'Payment is already verified/rejected (or was just handled) and cannot be re-verified.' },
        { status: 409 }
      );
    }
    if (error.message.includes('order_item_not_found')) {
      return NextResponse.json({ error: 'Order item not found for this payment' }, { status: 404 });
    }
    if (error.message.includes('amount_exceeds_balance')) {
      const remainingBeforeThis = Number(orderItem.price) - Number(orderItem.deposit_paid);
      return NextResponse.json(
        {
          error: 'amount_exceeds_balance',
          message: `Payment amount (${payment.amount}) exceeds the remaining balance (${remainingBeforeThis}). Resubmit with { "confirmOverpayment": true } to proceed anyway.`,
          remainingBeforeThis,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...data });
}
