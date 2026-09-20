// src/app/api/admin/promo-banners/route.ts
//
// Admin CRUD for public.promo_banners (migration 093_promo_banners.sql,
// phase 1). GET returns every row (active + inactive + scheduled) so
// PromoBannersManager.tsx can show the admin the full list, unlike
// fetchActivePromoBanners() in lib/data.ts which is the public/anon
// read filtered to only currently-live slides.
//
// Unlike transport-vehicle-pricing's route (fixed 4-row set, PATCH
// only), promo_banners is admin-creatable/deletable — there's no
// fixed row set, an admin adds a new slide whenever a new promotion
// starts.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';

export async function GET() {
  const cookieCarrier = new NextResponse();
  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('promo_banners')
    .select('*')
    .order('display_order', { ascending: true });

  if (error) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  return withRefreshedCookies(NextResponse.json({ banners: data }), cookieCarrier);
}

export async function POST(request: NextRequest) {
  const cookieCarrier = new NextResponse();
  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.image_url !== 'string' || !body.image_url.trim()) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'missing_fields', detail: 'image_url is required' },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  // New slides land at the end of the list by default — admin can
  // then drag it into position (PromoBannersManager.tsx's reorder
  // calls /reorder, which renumbers display_order for the whole list;
  // see 093's header comment on why a plain integer, not a
  // fractional key, is fine here).
  const { count } = await supabase
    .from('promo_banners')
    .select('*', { count: 'exact', head: true });

  const { data: banner, error } = await supabase
    .from('promo_banners')
    .insert({
      image_url: body.image_url.trim(),
      link_url: typeof body.link_url === 'string' && body.link_url.trim() ? body.link_url.trim() : null,
      title: typeof body.title === 'string' ? body.title.trim() : '',
      display_order: typeof body.display_order === 'number' ? body.display_order : count ?? 0,
      is_active: typeof body.is_active === 'boolean' ? body.is_active : true,
      start_date: body.start_date || null,
      end_date: body.end_date || null,
    })
    .select('*')
    .single();

  if (error || !banner) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'create_failed', detail: error?.message },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'promo_banner.create',
    entityType: 'promo_banner',
    entityId: banner.id,
    after: banner,
  });

  return withRefreshedCookies(NextResponse.json({ banner }, { status: 201 }), cookieCarrier);
}
