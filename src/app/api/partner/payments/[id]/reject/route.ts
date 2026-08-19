// src/app/api/partner/payments/[id]/reject/route.ts
//
// POST /api/partner/payments/:id/reject
// Body: { "reason": "slip amount doesn't match, please resend" }
//
// Companion to verify/route.ts — same auth/ownership model, but marks
// the payment rejected instead of rolling it into deposit_paid. Uses
// the same atomic-claim UPDATE ... WHERE status IN (...) pattern as
// admin reject, so two concurrent reject calls (or a reject racing a
// verify) on the same payment can't both appear to succeed.

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

  const paymentId = params.id;

  // Ownership check via the RLS-enforced client, same pattern as verify.
  const supabase = createClient(cookieCarrier);
  const { data: payment, error: fetchError } = await supabase
    .from('payments')
    .select('id, order_item_id')
    .eq('id', paymentId)
    .single();

  if (fetchError || !payment) {
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

  const service = createServiceClient();
  const { data: rejected, error: updateError } = await service
    .from('payments')
    .update({
      status: 'rejected',
      verified_by: user.id,
      verified_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .in('status', ['waiting_verification', 'pending'])
    .eq('id', paymentId)
    .select('id');

  if (updateError) {
    return withRefreshedCookies(
      NextResponse.json({ error: updateError.message }, { status: 500 }),
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

  // No deposit_paid change — rejected payments never counted toward the
  // balance in the first place.

  return withRefreshedCookies(NextResponse.json({ success: true, paymentId }), cookieCarrier);
}
