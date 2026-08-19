// app/api/quote/[orderNumber]/confirm/route.ts
//
// PUBLIC endpoint — customer clicks "ยืนยันรายการนี้" on the quote page.
// Only allowed transition: draft -> pending_deposit. Admin then follows
// up with the customer to collect the deposit (payment flow is Phase 3,
// not wired here). Rejects if the order isn't in 'draft' status, so a
// customer can't re-confirm an already-confirmed or cancelled order.
//
// SECURITY: order_number is a predictable sequence, not a secret.
// As of this fix, requires `?token=` (orders.payment_access_token)
// alongside order_number before mutating status — previously anyone
// who knew/guessed order_number could force draft -> pending_deposit
// on someone else's order.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';
import { loadAuthorizedOrder } from '@/lib/orders/authorize-order';

export async function POST(
  request: Request,
  { params }: { params: { orderNumber: string } }
) {
  const { orderNumber } = params;
  if (!orderNumber) {
    return NextResponse.json({ error: 'missing order number' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const { allowed } = simpleRateLimit(`quote-confirm:${ip}`, 10, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  const supabase = createServiceClient();

  const token = new URL(request.url).searchParams.get('token');
  const { order, error: authError } = await loadAuthorizedOrder(supabase, orderNumber, token);
  if (authError) return authError;

  if (order!.status !== 'draft') {
    return NextResponse.json(
      { error: 'รายการนี้ยืนยันไปแล้ว หรือไม่สามารถยืนยันได้อีก' },
      { status: 409 }
    );
  }

  const { error: updateErr } = await supabase
    .from('orders')
    .update({ status: 'pending_deposit' })
    .eq('id', order!.id);

  if (updateErr) {
    console.error('confirm order failed:', updateErr);
    return NextResponse.json({ error: 'ยืนยันไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
