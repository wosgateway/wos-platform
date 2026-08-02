// src/app/api/partner/payments/[id]/reject/route.ts
//
// POST /api/partner/payments/:id/reject
// Body: { "reason": "slip amount doesn't match, please resend" }
//
// Companion to verify/route.ts — same auth/ownership model, but marks
// the payment rejected instead of rolling it into deposit_paid.

import { NextResponse } from 'next/server';
import { getPartnerSession, hasPermission } from '@/lib/partner/auth';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user } = await getPartnerSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasPermission(user, 'manage_payments')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const reason: string | undefined = body?.reason?.trim();
  if (!reason) {
    return NextResponse.json({ error: 'A rejection reason is required.' }, { status: 400 });
  }

  const paymentId = params.id;

  // Ownership check via the RLS-enforced client, same pattern as verify.
  const supabase = createClient();
  const { data: payment, error: fetchError } = await supabase
    .from('payments')
    .select('id, status, order_item_id')
    .eq('id', paymentId)
    .single();

  if (fetchError || !payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  if (payment.status !== 'waiting_verification' && payment.status !== 'pending') {
    return NextResponse.json(
      { error: `Payment is already "${payment.status}" and cannot be rejected.` },
      { status: 409 }
    );
  }

  const service = createServiceClient();
  const { error: updateError } = await service
    .from('payments')
    .update({
      status: 'rejected',
      verified_by: user.id,
      verified_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', paymentId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // No deposit_paid change — rejected payments never counted toward the
  // balance in the first place.

  return NextResponse.json({ success: true, paymentId });
}
