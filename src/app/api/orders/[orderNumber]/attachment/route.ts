// src/app/api/orders/[orderNumber]/attachment/route.ts
//
// PATCH /api/orders/[orderNumber]/attachment
//   body: { payment_access_token: string, path: string }
//
// Step 3 (final) of the booking-attachment flow (see migration 069):
// called after the browser has already PUT the file to the signed
// URL from POST .../attachment-upload-url. This route re-validates
// the token (never trusts that a prior step succeeded) and confirms
// the object actually exists at the given path in
// booking-attachments before writing it onto the order — a client
// can't claim an arbitrary/unwritten path was uploaded and have it
// silently accepted.
//
// path is not trusted blindly even though it's checked against
// storage: it must additionally start with `${orderNumber}/`, so a
// caller with one order's valid token can't attach a path that was
// actually uploaded under a DIFFERENT order's folder (e.g. one they
// saw returned from a previous request of their own on another
// order, or guessed). Ties the object to the same order the token
// authorizes, not just "some real object exists somewhere in the
// bucket".

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';
import { loadAuthorizedOrder } from '@/lib/orders/authorize-order';

const CLOSED_STATUSES = ['completed', 'cancelled', 'refunded'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  const { orderNumber } = params;
  if (!orderNumber) {
    return NextResponse.json({ error: 'orderNumber is required' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipLimit = await simpleRateLimit(`attachment-confirm:ip:${ip}`, 20, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: 'too many requests, please try again later' }, { status: 429 });
  }

  let body: { payment_access_token?: string; path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const token = body.payment_access_token;
  const path = body.path;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'payment_access_token is required' }, { status: 400 });
  }
  if (!path || typeof path !== 'string' || !path.startsWith(`${orderNumber}/`)) {
    return NextResponse.json({ error: 'path must belong to this order' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { order, error: authError } = await loadAuthorizedOrder(
  supabase,
  orderNumber,
  token
);

if (authError) return authError;

if (CLOSED_STATUSES.includes(order!.status)) {
  return NextResponse.json({ error: 'order is closed' }, { status: 409 });
}

  // Confirm the object is actually there before trusting the path —
  // list() on the parent folder and match the exact filename, since
  // Supabase Storage has no direct "stat a single object" call.
  const folder = orderNumber;
  const objectName = path.slice(folder.length + 1);
  const { data: listing, error: listErr } = await supabase.storage
  .from('booking-attachments')
  .list(folder, {
    search: objectName,
    limit: 100,
  });

const objectExists = listing?.some((item) => item.name === objectName);

if (listErr || !objectExists) {
  return NextResponse.json(
    { error: 'uploaded object not found' },
    { status: 400 }
  );
}

  const { error: updateErr } = await supabase
    .from('orders')
    .update({ attachment_url: path })
    .eq('id', order!.id);

  if (updateErr) {
    console.error('failed to save attachment_url:', updateErr);
    return NextResponse.json({ error: 'failed to save attachment' }, { status: 500 });
  }

  return NextResponse.json({ attachment_url: path });
}
