// app/api/quote/[orderNumber]/payments/route.ts
//
// PUBLIC endpoints — no customer *login*, but as of migration 021
// they DO require `?token=` (orders.payment_access_token) alongside
// order_number. order_number alone is NOT a secret — it's a
// predictable sequence (see generate_order_number()) — so it must
// never be the only thing standing between a request and someone
// else's payment data. The frontend gets the token from the secure
// link it was sent (same link that already carries order_number).
//
// POST — customer submits a slip after uploading it to the
//   `payment-slips` storage bucket client-side (see migration 017).
//   Creates a whole-order payment (order_item_id = NULL) with status
//   'waiting_verification'. Whole-order payments are NOT visible to
//   partner staff — an admin verifies these via
//   /api/admin/payments/[id]/verify.
//
//   Server-computed, NOT client-trusted:
//     - amount: capped to the order's actual remaining balance
//     - currency: always order.currency, client value is ignored
//
// GET — lets the customer's page poll/refresh to see whether their
//   slip has been verified/rejected yet.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';

const ALLOWED_METHODS = ['bank_transfer', 'qr'] as const;
type PaymentMethod = (typeof ALLOWED_METHODS)[number];

interface CreatePaymentBody {
  amount: number;
  method?: PaymentMethod;
  slip_url: string;
  // currency intentionally NOT accepted from the client — see header.
}

// Storage host allowed for slip_url, derived from the same env var
// the rest of the app uses to talk to Supabase Storage. Prevents an
// attacker-supplied URL like https://evil.com/payment-slips/x.jpg
// from passing a naive `.includes('/payment-slips/')` check.
function getAllowedSlipHost(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return null;
  }
}

function isValidSlipUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const allowedHost = getAllowedSlipHost();
  if (!allowedHost || url.host !== allowedHost) return false;
  // Supabase public storage URLs look like:
  //   https://<project>.supabase.co/storage/v1/object/public/payment-slips/<path>
  const pathOk = /\/storage\/v1\/object\/public\/payment-slips\//.test(url.pathname);
  return pathOk;
}

function validate(body: Partial<CreatePaymentBody>): string | null {
  if (typeof body.amount !== 'number' || !(body.amount > 0)) {
    return 'amount must be a positive number';
  }
  if (!body.slip_url || typeof body.slip_url !== 'string') {
    return 'slip_url is required';
  }
  if (!isValidSlipUrl(body.slip_url)) {
    return 'slip_url must be a valid https URL in our own payment-slips storage bucket';
  }
  if (body.method && !ALLOWED_METHODS.includes(body.method)) {
    return `method must be one of: ${ALLOWED_METHODS.join(', ')}`;
  }
  return null;
}

async function loadAuthorizedOrder(
  supabase: ReturnType<typeof createServiceClient>,
  orderNumber: string,
  token: string | null
) {
  if (!token) {
    return { order: null, error: NextResponse.json({ error: 'ลิงก์ไม่ถูกต้อง (missing access token)' }, { status: 401 }) };
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select(
      'id, order_number, status, currency, total_amount, total_deposit_required, total_deposit_paid, total_balance_remaining, payment_access_token'
    )
    .eq('order_number', orderNumber)
    .single();

  if (orderErr || !order) {
    return { order: null, error: NextResponse.json({ error: 'ไม่พบใบเสนอราคานี้' }, { status: 404 }) };
  }

  if (order.payment_access_token !== token) {
    return { order: null, error: NextResponse.json({ error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' }, { status: 403 }) };
  }

  return { order, error: null };
}

export async function POST(
  request: Request,
  { params }: { params: { orderNumber: string } }
) {
  const { orderNumber } = params;
  if (!orderNumber) {
    return NextResponse.json({ error: 'missing order number' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const { allowed } = simpleRateLimit(`payment-submit:${ip}`, 10, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  let body: Partial<CreatePaymentBody>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const validationError = validate(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const supabase = createServiceClient();

  const token = new URL(request.url).searchParams.get('token');
  const { order, error: authError } = await loadAuthorizedOrder(supabase, orderNumber, token);
  if (authError) return authError;
  // order is non-null here (authError would have returned otherwise)

  const blockedStatuses = ['draft', 'cancelled', 'refunded', 'completed'];
  if (blockedStatuses.includes(order!.status)) {
    return NextResponse.json(
      { error: `ไม่สามารถส่งสลิปได้ในสถานะ "${order!.status}"` },
      { status: 409 }
    );
  }

  // --- amount: server-computed cap, never trust the client's number ---
  const remaining =
    order!.total_balance_remaining ??
    Math.max(Number(order!.total_deposit_required ?? 0) - Number(order!.total_deposit_paid ?? 0), 0);

  if (remaining <= 0) {
    return NextResponse.json({ error: 'ไม่มียอดคงเหลือที่ต้องชำระ' }, { status: 409 });
  }

  const { amount: requestedAmount, method } = body as CreatePaymentBody;
  if (requestedAmount > remaining) {
    return NextResponse.json(
      { error: `จำนวนเงินเกินยอดคงเหลือที่ต้องชำระ (คงเหลือ ${remaining})` },
      { status: 400 }
    );
  }
  const amount = requestedAmount;

  // --- currency: always the order's own currency, never the client's ---
  const currency = order!.currency || 'THB';

  const { data: payment, error: insertErr } = await supabase
    .from('payments')
    .insert({
      order_id: order!.id,
      order_item_id: null, // whole-order payment — see file header
      amount,
      currency,
      method: method ?? null,
      slip_url: body.slip_url,
      status: 'waiting_verification',
      submitted_at: new Date().toISOString(),
    })
    .select('id, status, amount, currency, submitted_at')
    .single();

  if (insertErr) {
    // Unique violation from payments_one_pending_whole_order_idx
    // (migration 021) — a payment for this order is already awaiting
    // verification. This is enforced by the DB, so it's race-safe
    // even against concurrent double-submits.
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { error: 'มีสลิปที่ส่งไว้แล้วรอการตรวจสอบอยู่ กรุณารอทีมงานตรวจสอบก่อนส่งใหม่' },
        { status: 409 }
      );
    }
    console.error('create payment failed:', insertErr);
    return NextResponse.json({ error: 'ส่งสลิปไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
  }

  // Move the order forward so admin sees it needs attention, WITHOUT
  // reusing 'deposit_paid' — that value is also used by
  // /api/admin/payments/[id]/verify for a *verified* partial payment,
  // and collapsing "submitted, unverified" into the same status as
  // "verified, partial" made the two indistinguishable to anyone
  // reading order.status. 'pending_verification' is a distinct value
  // — see migration 021 for the manual step needed to allow it if
  // orders.status has a CHECK constraint.
  if (order!.status === 'pending_deposit') {
    await supabase.from('orders').update({ status: 'pending_verification' }).eq('id', order!.id);
  }

  return NextResponse.json({ success: true, payment }, { status: 201 });
}

export async function GET(
  request: Request,
  { params }: { params: { orderNumber: string } }
) {
  const { orderNumber } = params;
  if (!orderNumber) {
    return NextResponse.json({ error: 'missing order number' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const { allowed } = simpleRateLimit(`payment-view:${ip}`, 60, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  const supabase = createServiceClient();

  const token = new URL(request.url).searchParams.get('token');
  const { order, error: authError } = await loadAuthorizedOrder(supabase, orderNumber, token);
  if (authError) return authError;

  const { data: payments, error: paymentsErr } = await supabase
    .from('payments')
    .select('id, amount, currency, method, status, submitted_at, verified_at, rejection_reason')
    .eq('order_id', order!.id)
    .order('submitted_at', { ascending: false });

  if (paymentsErr) {
    console.error('fetch payments failed:', paymentsErr);
    return NextResponse.json({ error: 'failed to load payments' }, { status: 500 });
  }

  // Don't leak payment_access_token back out in the response.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { payment_access_token: _omit, ...safeOrder } = order!;

  return NextResponse.json({ order: safeOrder, payments: payments ?? [] });
}
