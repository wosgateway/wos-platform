// src/app/api/quote/[orderNumber]/upload-slip-url/route.ts
//
// POST /api/quote/[orderNumber]/upload-slip-url?token=...
//   body: { filename: string }
//   -> { path, token, signedUrl }
//
// Replaces the old flow where the client uploaded straight to the
// `payment-slips` bucket under the open "Anyone can upload payment
// slips" policy (with_check: bucket_id only, migration 019/033/066).
// That policy had no way to check payment_access_token -- storage RLS
// never sees it -- and order_number is a predictable sequence
// (generate_order_number()), so anyone could upload a decoy slip into
// any other customer's still-open order folder. Moving the check here
// closes that: this route verifies the token server-side (same
// loadAuthorizedOrder() every other public order route uses) BEFORE
// minting a signed upload URL scoped to one exact path. Migration 068
// drops the old anon INSERT policy entirely -- uploads only work
// through a token from this route now, never a raw client upload.
//
// filename is only used for the human-readable suffix in the path;
// the real uniqueness/ownership comes from the object path itself,
// which lives only under `${orderNumber}/...`.

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';
import { loadAuthorizedOrder } from '@/lib/orders/authorize-order';

const CLOSED_STATUSES = ['completed', 'cancelled', 'refunded'];

export async function POST(
  request: Request,
  { params }: { params: { orderNumber: string } }
) {
  const { orderNumber } = params;
  if (!orderNumber) {
    return NextResponse.json({ error: 'missing order number' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const { allowed } = await simpleRateLimit(`upload-slip-url:${ip}`, 10, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  const supabase = createServiceClient();
  const { order, error } = await loadAuthorizedOrder(supabase, orderNumber, token);
  if (error) return error;

  if (CLOSED_STATUSES.includes(order!.status)) {
    return NextResponse.json({ error: 'order นี้ปิดแล้ว ไม่รับสลิปเพิ่ม' }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const rawFilename = typeof body?.filename === 'string' && body.filename ? body.filename : 'slip';
  // Strip path separators so a crafted filename can't escape the
  // `${orderNumber}/` prefix or add extra folder segments.
  const safeFilename = rawFilename.replace(/[/\\]/g, '_');
  const path = `${orderNumber}/${randomUUID()}-${safeFilename}`;

  const { data, error: signError } = await supabase.storage
    .from('payment-slips')
    .createSignedUploadUrl(path);

  if (signError || !data) {
    console.error('createSignedUploadUrl (payment-slips) failed:', signError);
    return NextResponse.json({ error: 'ออก upload link ไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token, signedUrl: data.signedUrl });
}
