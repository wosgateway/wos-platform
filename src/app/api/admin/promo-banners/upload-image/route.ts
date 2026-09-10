// src/app/api/admin/promo-banners/upload-image/route.ts
//
// Signed-upload-URL route for the `promo-banners` bucket
// (093_promo_banners.sql), same shape as
// admin/partners/upload-image/route.ts and for the same reason: the
// bucket has no per-caller ownership column to scope an RLS insert
// policy to (093 deliberately added no insert/update/delete storage
// policy at all — see that migration's comments), so admins upload
// via a signed URL minted server-side with the service-role client
// after requireAdmin() passes, bypassing RLS entirely rather than
// trying to write one.
//
// Simpler than the partners version: no `kind` (cover/logo) — every
// object in this bucket is just one slide's image, flat, no subfolder.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';

const BUCKET = 'promo-banners';

// Timestamp + sanitized filename, flat (no subfolder) — matches
// exactly what this route generates, so DELETE can't be pointed at
// anything outside what it itself created.
const MANAGED_PATH = /^\d{10,}_[a-zA-Z0-9._-]+$/;

function sanitizeFilename(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_').trim();
  return (cleaned || 'file').slice(0, 150);
}

export async function POST(request: Request) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const rateLimit = await simpleRateLimit(`admin-upload-promo-banner:${auth.user.id}`, 60, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Too many upload requests — try again later.' }, { status: 429 }),
      cookieCarrier
    );
  }

  let body: { filename?: string };
  try {
    body = await request.json();
  } catch {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
      cookieCarrier
    );
  }

  const filename = body.filename?.trim();
  if (!filename) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'filename is required' }, { status: 400 }),
      cookieCarrier
    );
  }

  const safeFilename = sanitizeFilename(filename);
  const path = `${Date.now()}_${safeFilename}`;

  const supabase = createServiceClient();
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (signErr || !signed) {
    console.error('admin promo-banners createSignedUploadUrl failed:', signErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 }),
      cookieCarrier
    );
  }

  return withRefreshedCookies(
    NextResponse.json({ path: signed.path, token: signed.token, signedUrl: signed.signedUrl }),
    cookieCarrier
  );
}

export async function DELETE(request: Request) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
      cookieCarrier
    );
  }

  const path = body.path?.trim();
  if (!path || !MANAGED_PATH.test(path)) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Invalid or unrecognized image path' }, { status: 400 }),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();
  const { error: removeErr } = await supabase.storage.from(BUCKET).remove([path]);

  if (removeErr) {
    console.error('admin promo-banners delete failed:', removeErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to delete image' }, { status: 500 }),
      cookieCarrier
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'promo_banner.image_delete',
    entityType: 'promo-banners-object',
    entityId: path,
  });

  return withRefreshedCookies(NextResponse.json({ success: true }), cookieCarrier);
}
