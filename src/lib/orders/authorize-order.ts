// src/lib/orders/authorize-order.ts
//
// Shared boundary for every customer-facing order endpoint (quote,
// confirm, payments, my-trip). order_number alone is NOT a secret —
// it's a predictable sequence (see generate_order_number()) — so it
// must never be the only thing standing between a request and
// someone else's order. Every public route must require
// `?token=` matching orders.payment_access_token (added in migration
// 021) alongside order_number.
//
// Extracted from the pattern already used correctly in
// /api/quote/[orderNumber]/payments/route.ts so /route.ts (quote) and
// /confirm/route.ts (confirm) stop being the two endpoints that skip
// this check.

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';

// Security Audit STEP 2/4, checkpoint item #4: `!==` on two strings
// short-circuits at the first differing byte, so comparison time
// leaks how many leading characters of a guessed token were correct
// — a timing side-channel against payment_access_token, the only
// thing gating every public quote/confirm/payments/my-trip route.
// Not the most practical attack (network jitter usually swamps a
// single-byte timing signal), but the fix is free, so do it properly.
//
// If lengths differ, still run a same-cost dummy comparison before
// returning false — an early return on length alone would itself
// leak the token's length.
export function tokensMatch(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);

  if (expectedBuf.length !== providedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  return timingSafeEqual(expectedBuf, providedBuf);
}

// Columns every caller of this helper needs today. If a route needs
// more, select them separately after this returns — don't grow this
// list per-caller, or it becomes unclear which fields are load-bearing
// for the token check itself.
const ORDER_COLUMNS =
  'id, order_number, status, currency, total_amount, total_deposit_required, total_deposit_paid, total_balance_remaining, patient_id, created_at, payment_access_token';

export interface AuthorizedOrder {
  id: string;
  order_number: string;
  status: string;
  currency: string | null;
  total_amount: number | null;
  total_deposit_required: number | null;
  total_deposit_paid: number | null;
  total_balance_remaining: number | null;
  patient_id: string | null;
  created_at: string;
  payment_access_token: string;
}

type Supabase = ReturnType<typeof createServiceClient>;

export async function loadAuthorizedOrder(
  supabase: Supabase,
  orderNumber: string,
  token: string | null
): Promise<{ order: AuthorizedOrder | null; error: NextResponse | null }> {
  if (!token) {
    return {
      order: null,
      error: NextResponse.json(
        { error: 'ลิงก์ไม่ถูกต้อง (missing access token)' },
        { status: 401 }
      ),
    };
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('order_number', orderNumber)
    .single();

  if (orderErr || !order) {
    return {
      order: null,
      error: NextResponse.json({ error: 'ไม่พบใบเสนอราคานี้' }, { status: 404 }),
    };
  }

  if (!tokensMatch(order.payment_access_token, token)) {
    return {
      order: null,
      error: NextResponse.json(
        { error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' },
        { status: 403 }
      ),
    };
  }

  return { order: order as AuthorizedOrder, error: null };
}

// Strips the token back out of an order object before it's ever
// serialized into a JSON response — the token is a bearer secret, it
// must never be echoed back to the client that's already holding it.
export function omitToken<T extends { payment_access_token?: unknown }>(
  order: T
): Omit<T, 'payment_access_token'> {

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { payment_access_token: _omit, ...rest } = order;

  return rest;
}
