// src/app/api/partner/payments/confirm-balance/route.ts
//
// POST /api/partner/payments/confirm-balance
// Body: {
//   orderItemId: string,
//   amount: number,
//   paymentMethod?: 'cash_at_clinic' | 'cash_at_hotel' | 'bank_transfer' | 'other',
//   reference?: string
// }
//
// There is no overpayment override: partner_balance_confirmed <=
// partner_balance is a hard invariant enforced by the RPC (migration
// 104) — an amount that would exceed it is always rejected.
//
// Companion to verify/route.ts, for a different kind of money —
// partner_balance instead of the WOS booking fee. There is no
// `payments` row to act on here: a partner using this route is
// attesting that a customer paid THEM directly (cash at the clinic,
// a bank transfer straight to the partner, etc.), so unlike
// verify/route.ts there's nothing to SELECT by id first, no slip, and
// no third party who could ever verify it independently — the
// partner both received the money and makes the only record of it.
//
// See migration 104 (partner_payment_confirmations) for the full
// reasoning: this route exists because partner_verify_payment used to
// accept exactly this kind of payment too, capped against `price`
// (the full package price) instead of `deposit_required`, which let a
// partner's own confirmation of money THEY received silently inflate
// WOS's booking-fee ledger (deposit_paid). That RPC is now capped at
// deposit_required only — anything beyond the booking fee belongs
// here instead.
//
// Same auth/ownership model as verify/route.ts — see that file for
// the fuller rationale on each piece.

import { NextResponse } from 'next/server';
import { getPartnerSession, hasPermission } from '@/lib/partner/auth';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_METHODS = new Set(['cash_at_clinic', 'cash_at_hotel', 'bank_transfer', 'other']);

export async function POST(request: Request) {
  // Used only as a place for Supabase to write a refreshed access/refresh
  // token pair into, via getPartnerSession's createClient(). Never
  // returned directly. Same pattern as verify/route.ts.
  const cookieCarrier = new NextResponse();

  // 1. Auth — same as verify/route.ts: logged-in partner user with
  //    permission to manage payments, linked to a branch/partner.
  const { user } = await getPartnerSession(cookieCarrier);
  if (!user) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      cookieCarrier
    );
  }
  if (!hasPermission(user, 'manage_payments')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      cookieCarrier
    );
  }

  const partnerId = user.branch?.partner_id;
  if (!partnerId) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Your account is not linked to a partner' }, { status: 403 }),
      cookieCarrier
    );
  }

  const body = await request.json().catch(() => ({}));
  const orderItemId = typeof body?.orderItemId === 'string' ? body.orderItemId : null;
  const amount = Number(body?.amount);
  const paymentMethod = ALLOWED_METHODS.has(body?.paymentMethod) ? body.paymentMethod : 'cash_at_clinic';
  const reference = typeof body?.reference === 'string' ? body.reference : null;

  if (!orderItemId) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'orderItemId is required' }, { status: 400 }),
      cookieCarrier
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 }),
      cookieCarrier
    );
  }

  // 2. Ownership pre-check via the RLS-enforced client, on purpose —
  //    same reasoning as verify/route.ts: order_items RLS already
  //    scopes SELECT to the caller's own partner, so a foreign
  //    order_item 404s here before the RPC is ever called. Also used
  //    to build a friendlier "amount exceeds balance" message (the
  //    RPC's own check, under the row lock, remains authoritative).
  const supabase = createClient(cookieCarrier);
  const { data: orderItem, error: fetchError } = await supabase
    .from('order_items')
    .select('id, partner_balance, partner_balance_confirmed')
    .eq('id', orderItemId)
    .single();

  if (fetchError || !orderItem) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Order item not found' }, { status: 404 }),
      cookieCarrier
    );
  }

  if (orderItem.partner_balance === null) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'This order item has not been assigned a package yet, so there is no partner balance to confirm.' },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  // 3. Claim + ownership check + write, atomically, via the RPC. Same
  //    reasoning as verify/route.ts step 3: called through the
  //    service-role client, so partnerId resolved above from the
  //    verified session is passed explicitly and re-checked inside
  //    the function (migration 104) as a DB-level backstop
  //    independent of the RLS pre-check above.
  const service = createServiceClient();
  const { data, error } = await service.rpc('partner_confirm_balance_payment', {
    p_order_item_id: orderItemId,
    p_confirmed_by_user_id: user.id,
    p_partner_id: partnerId,
    p_amount: amount,
    p_payment_method: paymentMethod,
    p_reference: reference,
    p_confirm_overpayment: false,
  });

  if (error) {
    if (error.message.includes('order_item_not_found')) {
      return withRefreshedCookies(
        NextResponse.json({ error: 'Order item not found' }, { status: 404 }),
        cookieCarrier
      );
    }
    if (error.message.includes('not_authorized')) {
      // Should be unreachable — the RLS pre-check above already 404s
      // a cross-partner order_item before we get here. Same handling
      // as verify/route.ts: don't distinguish this from "not found".
      return withRefreshedCookies(
        NextResponse.json({ error: 'Order item not found' }, { status: 404 }),
        cookieCarrier
      );
    }
    if (error.message.includes('item_not_assigned')) {
      return withRefreshedCookies(
        NextResponse.json(
          { error: 'This order item has not been assigned a package yet, so there is no partner balance to confirm.' },
          { status: 400 }
        ),
        cookieCarrier
      );
    }
    if (error.message.includes('amount_exceeds_balance')) {
      const remainingBeforeThis = Number(orderItem.partner_balance) - Number(orderItem.partner_balance_confirmed);
      return withRefreshedCookies(
        NextResponse.json(
          {
            error: 'amount_exceeds_balance',
            message: `Confirmation amount (${amount}) exceeds the remaining partner balance (${remainingBeforeThis}). partner_balance_confirmed can never exceed partner_balance — split this into a smaller confirmation, or resolve the discrepancy (refund, or a corrected package assignment) before recording it.`,
            remainingBeforeThis,
          },
          { status: 409 }
        ),
        cookieCarrier
      );
    }
    if (error.message.includes('invalid_amount')) {
      return withRefreshedCookies(
        NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 }),
        cookieCarrier
      );
    }
    return withRefreshedCookies(
      NextResponse.json({ error: error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  return withRefreshedCookies(NextResponse.json({ success: true, ...data }), cookieCarrier);
}
