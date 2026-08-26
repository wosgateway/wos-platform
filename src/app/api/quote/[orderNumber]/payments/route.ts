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
//   `payment-slips` storage bucket client-side (see migration 017),
//   sending back the object path (slip_path) it just uploaded to —
//   not a public URL, since migration 033 made the bucket private.
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
import { attachSignedSlipUrls } from '@/lib/storage/signed-slip-url';
import { loadAuthorizedOrder } from '@/lib/orders/authorize-order';

const ALLOWED_METHODS = ['bank_transfer', 'qr'] as const;
type PaymentMethod = (typeof ALLOWED_METHODS)[number];

// `payments.payment_method` (the original NOT NULL column from
// migration 008) has a CHECK constraint allowing only:
//   'one_bank_qr' | 'bank_transfer' | 'promptpay' | 'cash_at_clinic' | 'cash_at_hotel'
// The app-facing ALLOWED_METHODS above ('bank_transfer' | 'qr') don't
// line up 1:1 with that — 'qr' is NOT a valid payment_method value,
// only 'one_bank_qr' is. Map every accepted client value to a value
// that satisfies chk_payment_method.
// Background: migration 019 added a second, unconstrained `method`
// column instead of reusing `payment_method`, so the insert below
// must populate BOTH columns — a straight copy isn't enough because
// of the 'qr' vs 'one_bank_qr' naming mismatch.
const METHOD_TO_PAYMENT_METHOD: Record<PaymentMethod, string> = {
  bank_transfer: 'bank_transfer',
  qr: 'one_bank_qr',
};
const DEFAULT_PAYMENT_METHOD = 'bank_transfer'; // payment_method is NOT NULL; used when the client omits `method`

interface CreatePaymentBody {
  amount: number;
  method?: PaymentMethod;
  // As of migration 033 `payment-slips` is a PRIVATE bucket, so the
  // client no longer has (or sends) a public URL — it sends the raw
  // object path it just uploaded to
  // (`${orderNumber}/${Date.now()}-${filename}`, see
  // my-trip/[orderNumber]/payment/page.tsx). Host/protocol validation
  // is unnecessary now: a private bucket has no public host to spoof,
  // so all that's left to check is ownership (below).
  slip_path: string;
  // currency intentionally NOT accepted from the client — see header.
}

// Ownership check: the customer payment page uploads to
// `${orderNumber}/${Date.now()}-${filename}`
// (see my-trip/[orderNumber]/payment/page.tsx), so a slip belongs to
// an order iff its object path is namespaced under that order's own
// number. Without this, a valid token for Order A's link is enough to
// submit *any* other order's slip path as Order A's payment — the
// token only proves you're allowed to act on Order A, it says nothing
// about which slip you're claiming. Reject anything that isn't
// exactly "<orderNumber>/<rest>", including attempts to fake the
// prefix (e.g. "ORD-1/../ORD-2/x" or "ORD-10/x" matching an "ORD-1"
// startsWith check) by requiring the literal next character be '/'.
function isValidSlipPath(path: string, orderNumber: string): boolean {
  if (path.includes('..')) return false;
  const prefix = `${orderNumber}/`;
  return path.startsWith(prefix) && path.length > prefix.length;
}

function validate(body: Partial<CreatePaymentBody>, orderNumber: string): string | null {
  if (typeof body.amount !== 'number' || !(body.amount > 0)) {
    return 'amount must be a positive number';
  }
  if (!body.slip_path || typeof body.slip_path !== 'string') {
    return 'slip_path is required';
  }
  if (!isValidSlipPath(body.slip_path, orderNumber)) {
    return 'slip_path must belong to this order';
  }
  if (body.method && !ALLOWED_METHODS.includes(body.method)) {
    return `method must be one of: ${ALLOWED_METHODS.join(', ')}`;
  }
  return null;
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
  const { allowed } = await simpleRateLimit(`payment-submit:${ip}`, 10, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  let body: Partial<CreatePaymentBody>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const validationError = validate(body, orderNumber);
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
      // Legacy NOT NULL column with its own CHECK constraint — see
      // METHOD_TO_PAYMENT_METHOD comment above. Must always be a
      // non-null value from chk_payment_method's allowed list.
      payment_method: method ? METHOD_TO_PAYMENT_METHOD[method] : DEFAULT_PAYMENT_METHOD,
      // DB column is still named `slip_url` (table not migrated — see
      // route header) but now stores a bare object path, not a public
      // URL. attachSignedSlipUrls() below/downstream resolves it.
      slip_url: body.slip_path,
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
    if (insertErr.code === '23514') {
      // chk_payment_method (or another CHECK constraint) rejected the
      // row — most likely METHOD_TO_PAYMENT_METHOD is missing an entry
      // for a newly added ALLOWED_METHODS value. Logged distinctly so
      // this isn't confused with a generic failure.
      console.error('create payment failed — CHECK constraint violation (likely METHOD_TO_PAYMENT_METHOD out of sync):', insertErr);
      return NextResponse.json({ error: 'ส่งสลิปไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
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
  const { allowed } = await simpleRateLimit(`payment-view:${ip}`, 60, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  const supabase = createServiceClient();

  const token = new URL(request.url).searchParams.get('token');
  const { order, error: authError } = await loadAuthorizedOrder(supabase, orderNumber, token);
  if (authError) return authError;

  const { data: payments, error: paymentsErr } = await supabase
    .from('payments')
    .select('id, amount, currency, method, status, submitted_at, verified_at, rejection_reason, slip_url')
    .eq('order_id', order!.id)
    .order('submitted_at', { ascending: false });

  if (paymentsErr) {
    console.error('fetch payments failed:', paymentsErr);
    return NextResponse.json({ error: 'failed to load payments' }, { status: 500 });
  }

  // slip_url in the DB is a stored path against the private
  // `payment-slips` bucket (migration 033) — not viewable as-is.
  // attachSignedSlipUrls() is normally admin/partner-only, but this
  // call site is a deliberate, scoped exception: loadAuthorizedOrder()
  // above already required `?token=` to match this order's
  // payment_access_token, which is the same ownership proof admin
  // routes rely on. The signed URL is generated fresh per request,
  // expires in 10 minutes, and is never cached or logged.
  const paymentsWithSlips = await attachSignedSlipUrls(payments ?? []);

  // Don't leak payment_access_token back out in the response.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { payment_access_token: _omit, ...safeOrder } = order!;

  return NextResponse.json({ order: safeOrder, payments: paymentsWithSlips });
}
