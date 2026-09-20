// src/app/api/partner/payments/[id]/reject/route.ts
//
// POST /api/partner/payments/:id/reject
// Body: { "reason": "slip amount doesn't match, please resend" }
//
// Companion to verify/route.ts — same auth/ownership model, and marks
// the payment rejected instead of rolling it into deposit_paid.
//
// The claim (status -> rejected) + ownership check now happen inside
// `partner_reject_payment` (migration 083), a single Postgres
// function — same shape as partner_verify_payment (migration 060).
// This used to be a raw UPDATE issued through the service-role client,
// relying solely on the RLS SELECT pre-check below to keep a partner
// from rejecting another partner's payment. That pre-check is real,
// but the RPC is what actually enforces `order_items.partner_id =
// p_partner_id` at the DB layer as a backstop independent of RLS —
// see migration 083 for the full writeup of the gap this closes.
import { NextResponse } from 'next/server';
import { getPartnerSession, hasPermission } from '@/lib/partner/auth';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  // Used only as a place for Supabase to write a refreshed access/refresh
  // token pair into, via getPartnerSession's createClient(). Never
  // returned directly. Same pattern as verify/route.ts and the admin
  // routes — see src/lib/admin/require-admin.ts for the rationale.
  const cookieCarrier = new NextResponse();

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

  const body = await request.json().catch(() => ({}));
  const reason: string | undefined = body?.reason?.trim();
  if (!reason) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'A rejection reason is required.' }, { status: 400 }),
      cookieCarrier
    );
  }

  // user.branch.partner_id is the real partner scope (matches
  // order_items.partner_id) — same as verify/route.ts. A staff user
  // not yet linked to a branch/partner has nothing to scope this to.
  const partnerId = user.branch?.partner_id;
  if (!partnerId) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Your account is not linked to a partner' }, { status: 403 }),
      cookieCarrier
    );
  }

  const paymentId = params.id;

  // Ownership check via the RLS-enforced client, on purpose: the SELECT
  // policy on `payments` already restricts rows to order_items whose
  // partner matches the caller's — a payment belonging to another
  // partner simply won't be returned. Defense in depth on top of the
  // RPC's own ownership check below (same reasoning as verify/route.ts).
  const supabase = createClient(cookieCarrier);
  const { data: payment, error: fetchError } = await supabase
    .from('payments')
    .select('id, order_item_id')
    .eq('id', paymentId)
    .single();

  if (fetchError || !payment) {
    // Either it doesn't exist, or RLS hid it because it belongs to a
    // different partner — same response either way so we don't leak which.
    return withRefreshedCookies(
      NextResponse.json({ error: 'Payment not found' }, { status: 404 }),
      cookieCarrier
    );
  }

  if (!payment.order_item_id) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'This payment is not tied to a single order item and cannot be rejected here.' },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  // Claim + ownership check, atomically, via the RPC. Called through
  // the service-role client, so the RPC has no session to resolve
  // partner scope from — partnerId resolved above from the verified
  // session is passed explicitly and checked against
  // order_items.partner_id inside the function (migration 083).
  const service = createServiceClient();
  const { data, error } = await service.rpc('partner_reject_payment', {
    p_payment_id: paymentId,
    p_verified_by_user_id: user.id,
    p_partner_id: partnerId,
    p_reason: reason,
  });

  if (error) {
    if (error.message.includes('payment_not_claimable')) {
      return withRefreshedCookies(
        NextResponse.json(
          { error: 'Payment is already handled (or was just handled) and cannot be rejected.' },
          { status: 409 }
        ),
        cookieCarrier
      );
    }
    if (error.message.includes('order_item_not_found')) {
      return withRefreshedCookies(
        NextResponse.json({ error: 'Order item not found for this payment' }, { status: 404 }),
        cookieCarrier
      );
    }
    if (error.message.includes('not_authorized')) {
      // Should be unreachable — the RLS pre-check above already 404s a
      // cross-partner payment before we get here. Reaching this means
      // that pre-check was bypassed somehow; treat it the same as
      // "not found" so we don't leak that the payment exists under
      // another partner.
      return withRefreshedCookies(
        NextResponse.json({ error: 'Payment not found' }, { status: 404 }),
        cookieCarrier
      );
    }
    if (error.message.includes('reason_required')) {
      return withRefreshedCookies(
        NextResponse.json({ error: 'A rejection reason is required.' }, { status: 400 }),
        cookieCarrier
      );
    }
    return withRefreshedCookies(
      NextResponse.json({ error: error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  // No deposit_paid change — rejected payments never counted toward the
  // balance in the first place.

  return withRefreshedCookies(NextResponse.json({ success: true, ...data }), cookieCarrier);
}
