// app/api/quote/[orderNumber]/confirm/route.ts
//
// PUBLIC endpoint — customer clicks "ยืนยันรายการนี้" on the quote page.
// Only allowed transition: draft -> pending_deposit. Admin then follows
// up with the customer to collect the deposit (payment flow is Phase 3,
// not wired here). Rejects if the order isn't in 'draft' status, so a
// customer can't re-confirm an already-confirmed or cancelled order.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';

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

  const { data: order, error: findErr } = await supabase
    .from('orders')
    .select('id, status')
    .eq('order_number', orderNumber)
    .single();

  if (findErr || !order) {
    return NextResponse.json({ error: 'ไม่พบใบเสนอราคานี้' }, { status: 404 });
  }

  if (order.status !== 'draft') {
    return NextResponse.json(
      { error: 'รายการนี้ยืนยันไปแล้ว หรือไม่สามารถยืนยันได้อีก' },
      { status: 409 }
    );
  }

  const { error: updateErr } = await supabase
    .from('orders')
    .update({ status: 'pending_deposit' })
    .eq('id', order.id);

  if (updateErr) {
    console.error('confirm order failed:', updateErr);
    return NextResponse.json({ error: 'ยืนยันไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
