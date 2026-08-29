// src/app/api/orders/[orderNumber]/attachment-upload-url/route.ts
//
// POST /api/orders/[orderNumber]/attachment-upload-url
//   body: { payment_access_token: string, filename: string }
//   returns: { path: string, token: string, signed_url: string }
//
// Step 2 of the booking-attachment flow (see migration 069): the
// order must already exist — BookingForm.tsx / JourneyBookingForm.tsx
// call this AFTER POST /api/orders succeeds, using the
// payment_access_token that call returned. This route never trusts a
// client-supplied order id/path; it resolves the order from
// orderNumber + validates the token server-side, then asks Supabase
// Storage for a short-lived signed upload URL under a path this
// route controls: `${orderNumber}/${uuid}-${sanitized filename}`.
//
// The signed upload URL is minted with the service-role client, which
// bypasses storage RLS entirely — that's what lets migration 069 drop
// the old anon INSERT policy on booking-attachments completely. The
// browser then PUTs the file straight to Supabase Storage using the
// returned token (see uploadToSignedUrl in the client), so the file
// bytes never pass through this Next.js route or count against its
// body-size limit.
//
// This route only ISSUES the upload slot — it does not write
// orders.attachment_url. That happens in the separate PATCH
// /api/orders/[orderNumber]/attachment route, after the browser
// confirms the upload succeeded, so a booking that fails/abandons the
// attachment step still has a valid order with attachment_url = null,
// same as if the customer never attached anything.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';
import { loadAuthorizedOrder } from '@/lib/orders/authorize-order';

const CLOSED_STATUSES = ['completed', 'cancelled', 'refunded'];

function sanitizeFilename(raw: string): string {
  // Strip anything that isn't safe in a storage path segment — no
  // path separators, no leading dots, no control chars. Keep it
  // short; the original name is cosmetic only (used for the
  // extension/display), never used to look anything up.
  const cleaned = raw
    .replace(/[/\\]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .trim();
  const fallback = 'file';
  const name = cleaned || fallback;
  return name.slice(0, 120);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  const { orderNumber } = params;
  if (!orderNumber) {
    return NextResponse.json({ error: 'orderNumber is required' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipLimit = await simpleRateLimit(`attachment-upload-url:ip:${ip}`, 20, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: 'too many requests, please try again later' }, { status: 429 });
  }

  let body: { payment_access_token?: string; filename?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const token = body.payment_access_token;
  const filename = body.filename;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'payment_access_token is required' }, { status: 400 });
  }
  if (!filename || typeof filename !== 'string') {
    return NextResponse.json({ error: 'filename is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Same shared helper used by every other public order route
  // (quote/confirm/payments/upload-slip-url) — timing-safe compare
  // against payment_access_token, not a manual `!==`. Token here comes
  // from the request body instead of a `?token=` query param, but
  // loadAuthorizedOrder doesn't care where the string came from.
  const { order, error: authError } = await loadAuthorizedOrder(supabase, orderNumber, token);
  if (authError) return authError;

  if (CLOSED_STATUSES.includes(order!.status)) {
    return NextResponse.json({ error: 'order is closed' }, { status: 409 });
  }

  const path = `${orderNumber}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;

  const { data: signed, error: signErr } = await supabase.storage
    .from('booking-attachments')
    .createSignedUploadUrl(path);

  if (signErr || !signed) {
    console.error('createSignedUploadUrl failed:', signErr);
    return NextResponse.json({ error: 'failed to create upload url' }, { status: 500 });
  }

  return NextResponse.json({
    path: signed.path,
    token: signed.token,
    signed_url: signed.signedUrl,
  });
}
