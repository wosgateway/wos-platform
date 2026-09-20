// src/app/api/admin/partners/upload-image/route.ts
//
// Root cause (see sql/003_storage_bucket_partner_images.sql): the
// `partner-images` org-scoped insert/update/delete policies check
// `(storage.foldername(name))[2] = organization_id` from public.users
// for the CALLER. That's correct for a partner uploading their own
// logo/cover, but PartnersManager.tsx (admin) was uploading straight
// from the browser with `supabase.storage.from('partner-images').upload()`
// under the admin's own session — admins have no organization_id at
// all, and the admin upload path (`${timestamp}_${filename}` /
// `logos/${timestamp}_${filename}`) never had an org segment to match
// in the first place, even for a brand-new partner that has no
// organization yet. Every admin cover/logo upload hit RLS 403s.
//
// Fix: admins never touch storage.objects RLS directly. This route
// verifies admin auth the normal way (requireAdmin), then mints a
// signed upload URL via the service-role client, which bypasses RLS
// entirely — same pattern already used for booking-attachments
// (attachment-upload-url/route.ts) and payment-slips
// (quote/[orderNumber]/upload-slip-url/route.ts). The browser then
// PUTs the file straight to Storage with that token; bytes never pass
// through this route, so there's no Next.js body-size concern.
//
// Deliberately NOT partner-id-scoped: unlike those two routes, this
// one has to work for a partner that doesn't exist yet (admin is
// still filling out the "create partner" form when they pick a cover
// photo/logo — see PartnersManager.tsx's handleSubmit, which only
// INSERTs the partner row after cover_image_url/logo_url are already
// set). Authorization is "is this an admin", not "does this partner
// belong to you" — there's no org/ownership check to make here, same
// as every other admin-only write in this file's sibling routes.
//
// DELETE mirrors this for the "remove image" button: also
// service-role (an admin never had per-object storage RLS access to
// begin with), also not partner-id-scoped for the same reason above.
// Path is restricted to the exact naming convention this route and
// PartnersManager.tsx's old client-side code both use, so this can't
// be turned into an arbitrary-object-in-the-bucket deleter.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';

const BUCKET = 'partner-images';

// Matches exactly what this route (and previously PartnersManager.tsx
// client-side) generate: an optional `logos/` prefix, a millisecond
// timestamp, then a sanitized filename. Anchored so a delete request
// can't climb into `organizations/`, `packages/`, `documents/` or any
// other prefix sharing this bucket.
const MANAGED_PATH = /^(logos\/)?\d{10,}_[a-zA-Z0-9._-]+$/;

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

  const rateLimit = await simpleRateLimit(`admin-upload-image:${auth.user.id}`, 60, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Too many upload requests — try again later.' }, { status: 429 }),
      cookieCarrier
    );
  }

  let body: { filename?: string; kind?: 'cover' | 'logo' };
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
  if (body.kind !== 'cover' && body.kind !== 'logo') {
    return withRefreshedCookies(
      NextResponse.json({ error: "kind must be 'cover' or 'logo'" }, { status: 400 }),
      cookieCarrier
    );
  }

  const safeFilename = sanitizeFilename(filename);
  const path =
    body.kind === 'logo' ? `logos/${Date.now()}_${safeFilename}` : `${Date.now()}_${safeFilename}`;

  const supabase = createServiceClient();
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (signErr || !signed) {
    console.error('admin partner-images createSignedUploadUrl failed:', signErr);
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
    console.error('admin partner-images delete failed:', removeErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Failed to delete image' }, { status: 500 }),
      cookieCarrier
    );
  }

  // Best-effort, non-blocking — same reasoning as every other admin
  // write in this project (logAdminAction swallows its own errors).
  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'partner.image_delete',
    entityType: 'partner-images-object',
    entityId: path,
  });

  return withRefreshedCookies(NextResponse.json({ success: true }), cookieCarrier);
}
