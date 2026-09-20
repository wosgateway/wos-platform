import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';

const EDITABLE_FIELDS = [
  'image_url',
  'link_url',
  'title',
  'display_order',
  'is_active',
  'start_date',
  'end_date',
] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();
  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return withRefreshedCookies(NextResponse.json({ error: 'invalid_json' }, { status: 400 }), cookieCarrier);
  }

  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) {
      // link_url/start_date/end_date are nullable — an empty string from
      // a cleared form input means "remove it", not the literal string.
      patch[key] = body[key] === '' ? null : body[key];
    }
  }

  if (Object.keys(patch).length === 0) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'no_editable_fields_provided' }, { status: 400 }),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  const { data: banner, error } = await supabase
    .from('promo_banners')
    .update(patch)
    .eq('id', params.id)
    .select('*')
    .single();

  if (error || !banner) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'update_failed', detail: error?.message ?? 'not found' },
        { status: error ? 400 : 404 }
      ),
      cookieCarrier
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'promo_banner.update',
    entityType: 'promo_banner',
    entityId: banner.id,
    after: banner,
  });

  return withRefreshedCookies(NextResponse.json({ banner }), cookieCarrier);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();
  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  // Row delete only — the banner's image object in the promo-banners
  // bucket is removed separately by PromoBannersManager.tsx calling
  // /upload-image's DELETE before (or after) this, same two-step
  // pattern as PartnersManager.tsx's deletePartnerImage(). No FK
  // points at promo_banners, so this never fails with a 23503 the way
  // drivers/[id]'s DELETE can.
  const { error } = await supabase.from('promo_banners').delete().eq('id', params.id);

  if (error) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'delete_failed', detail: error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'promo_banner.delete',
    entityType: 'promo_banner',
    entityId: params.id,
  });

  return withRefreshedCookies(NextResponse.json({ deleted: true }), cookieCarrier);
}
