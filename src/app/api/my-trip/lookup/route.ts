// app/api/my-trip/lookup/route.ts
//
// PUBLIC endpoint backing the /[locale]/my-trip lookup form. A
// customer who lost/never had their WhatsApp/LINE link can't use the
// token-based flow (loadAuthorizedOrder, /api/quote/[orderNumber])
// directly — they only have an order number and their own phone
// number in hand. This route re-derives the token for them *after*
// proving they know both, then the client redirects to
// /my-trip/[orderNumber]?token=... same as every other entry point.
//
// SECURITY MODEL:
// order_number alone is a predictable, guessable sequence
// (WOS-YYYYMMDD-00001, 00002, ... — see authorize-order.ts) so it can
// never be the only credential here. Phone number is the second
// factor. Two things follow from that:
//
//   1. Never let the response distinguish "no such order" from
//      "order exists but phone didn't match" — either leak turns this
//      into an order-number-confirmation oracle. Both cases return
//      the exact same generic 404 message.
//   2. Rate-limit by IP AND by the submitted order_number, not just
//      IP. IP-only limiting still lets one visitor slowly try many
//      phone numbers against a single order_number they got from,
//      say, a leaked screenshot. Limiting per-order_number too caps
//      that regardless of how many IPs/requests are spread across.
//
// Phone comparison goes through normalizePhone() on both sides so
// "081-234-5678" typed here matches "+66812345678" stored on the
// customer row (see src/lib/phone.ts header for why this can't be a
// simple string equality).

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/phone';

// Same wording for every failure case on purpose — see header.
const GENERIC_ERROR = 'ไม่พบข้อมูลการจอง กรุณาตรวจสอบเลขที่คำสั่งซื้อและเบอร์โทรศัพท์อีกครั้ง';

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';

  let body: { order_number?: string; phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const orderNumber = body.order_number?.trim();
  const rawPhone = body.phone?.trim();

  if (!orderNumber || !rawPhone) {
    return NextResponse.json(
      { error: 'กรุณากรอกเลขที่คำสั่งซื้อและเบอร์โทรศัพท์' },
      { status: 400 }
    );
  }

  // IP-wide cap: slow down anyone trying many order_number/phone
  // combinations from one place.
  const ipLimit = await simpleRateLimit(`my-trip-lookup:ip:${ip}`, 20, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: 'ลองใหม่อีกครั้งภายหลัง' }, { status: 429 });
  }

  // Per-order_number cap: slow down brute-forcing phone numbers
  // against one specific, already-known order_number.
  const orderLimit = await simpleRateLimit(`my-trip-lookup:order:${orderNumber}`, 10, 60 * 60 * 1000);
  if (!orderLimit.allowed) {
    return NextResponse.json({ error: 'ลองใหม่อีกครั้งภายหลัง' }, { status: 429 });
  }

  const normalizedInputPhone = normalizePhone(rawPhone);
  if (!normalizedInputPhone) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 404 });
  }

  const supabase = createServiceClient();

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('order_number, patient_id, payment_access_token')
    .eq('order_number', orderNumber)
    .single();

  if (orderErr || !order) {
    // Same message/status as a phone mismatch below — don't reveal
    // whether the order_number itself exists.
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 404 });
  }

  const { data: customer, error: customerErr } = await supabase
    .from('customers')
    .select('phone')
    .eq('id', order.patient_id)
    .single();

  if (customerErr || !customer) {
    console.error('my-trip lookup: customer fetch failed for order', orderNumber, customerErr);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 404 });
  }

  if (normalizePhone(customer.phone) !== normalizedInputPhone) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 404 });
  }

  return NextResponse.json({
    order_number: order.order_number,
    token: order.payment_access_token,
  });
}
