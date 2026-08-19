// app/api/admin/payments/[id]/reject/route.ts
//
// Admin-side counterpart to /api/partner/payments/[id]/reject, for
// whole-order payments (order_item_id IS NULL) — see verify/route.ts
// in this same folder for why admin needs its own pair instead of
// reusing the partner-portal routes.
//
// The status transition is done as a single conditional UPDATE ...
// WHERE status IN (...), same atomic-claim pattern as verify — a
// fetch-then-check-then-update sequence would leave a small window
// where two concurrent reject calls (or a reject racing a verify)
// could both appear to succeed.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: Request, { params }: { params: { id: string } }) {
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

  const body = await request.json().catch(() => ({}));
  const reason: string | undefined = body?.reason?.trim();
  if (!reason) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'A rejection reason is required.' }, { status: 400 }),
      cookieCarrier
    );
  }

  const paymentId = params.id;
  const supabase = createServiceClient();

  const { data: payment, error: fetchErr } = await supabase
    .from('payments')
    .select('id, order_item_id')
    .eq('id', paymentId)
    .single();

  if (fetchErr || !payment) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Payment not found' }, { status: 404 }),
      cookieCarrier
    );
  }

  if (payment.order_item_id) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'This payment is tied to a single order item — reject it from the partner portal instead.' },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  // Atomic claim: only succeeds if the payment is STILL
  // waiting_verification/pending at the moment this statement runs.
  const { data: rejected, error: updateErr } = await supabase
    .from('payments')
    .update({
  status: 'rejected',
  verified_at: new Date().toISOString(),
  rejection_reason: reason,
})
    .in('status', ['waiting_verification', 'pending'])
    .eq('id', paymentId)
    .select('id');

  if (updateErr) {
    return withRefreshedCookies(
      NextResponse.json({ error: updateErr.message }, { status: 500 }),
      cookieCarrier
    );
  }

  if (!rejected || rejected.length === 0) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'Payment is already handled (or was just handled) and cannot be rejected.' },
        { status: 409 }
      ),
      cookieCarrier
    );
  }

  // Order status intentionally left alone (still 'pending_deposit' or
  // 'deposit_paid' from a partial prior payment) so the customer's
  // payment page can prompt them to resubmit a corrected slip.

  return withRefreshedCookies(NextResponse.json({ success: true, paymentId }), cookieCarrier);
}
