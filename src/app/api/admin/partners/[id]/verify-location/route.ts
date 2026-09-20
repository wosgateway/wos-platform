// src/app/api/admin/partners/[id]/verify-location/route.ts
//
// Admin-only. Sets location_status to 'verified' or 'rejected' on an
// already-resolved partner location (see resolve-location/route.ts,
// which only ever lands a partner at 'pending').
//
// This used to be done straight from the browser via the RLS-protected
// client (PartnersManager.tsx's old handleSetLocationStatus). Moved
// server-side so the action goes through logAdminAction (073) like
// every other admin mutation here — verify/reject on location_status
// gates public visibility on the map (047 nearby_partners()), so who
// verified what and when needs to be recoverable.
//
// Auth follows the same pattern as every other admin route in this
// project: cookieCarrier + requireAdmin(cookieCarrier) +
// withRefreshedCookies on every response.

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);

  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const partnerId = params.id;

  let body: { status?: 'verified' | 'rejected' };

  try {
    body = await request.json();
  } catch {
    return withRefreshedCookies(
      NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }),
      cookieCarrier
    );
  }

  if (body.status !== 'verified' && body.status !== 'rejected') {
    return withRefreshedCookies(
      NextResponse.json(
        { error: "status ต้องเป็น 'verified' หรือ 'rejected'" },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  const { data: before, error: fetchErr } = await supabase
    .from('partners')
    .select('id, name, location_status, latitude, longitude, location_source')
    .eq('id', partnerId)
    .single();

  if (fetchErr || !before) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'ไม่พบพาร์ทเนอร์นี้' }, { status: 404 }),
      cookieCarrier
    );
  }

  if (before.latitude == null || before.longitude == null) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'พาร์ทเนอร์นี้ยังไม่มีพิกัด — resolve ตำแหน่งก่อน' },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  // A rejected location was rejected for a reason (wrong pin, closed
  // location, bad data) — re-verifying it straight from 'rejected'
  // would let that reason go unaddressed. Force a fresh resolve
  // (which always lands back at 'pending', see resolve-location/
  // route.ts) before it can be verified again.
  if (before.location_status === 'rejected' && body.status === 'verified') {
    return withRefreshedCookies(
      NextResponse.json(
        {
          error:
            'พาร์ทเนอร์นี้ถูก reject ไว้ — ต้อง resolve ตำแหน่งใหม่ก่อน ถึงจะ verify ได้',
        },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  const nowIso = new Date().toISOString();

  const { data: after, error: updateErr } = await supabase
    .from('partners')
    .update({
      location_status: body.status,
      location_verified_at: body.status === 'verified' ? nowIso : null,
    })
    .eq('id', partnerId)
    .select('id, name, location_status, location_verified_at, latitude, longitude, location_source')
    .single();

  if (updateErr || !after) {
    return withRefreshedCookies(
      NextResponse.json(
        {
          error:
            'อัปเดตสถานะไม่สำเร็จ: ' + (updateErr?.message ?? 'unknown error'),
        },
        { status: 500 }
      ),
      cookieCarrier
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action:
      body.status === 'verified'
        ? 'partner.location_verify'
        : 'partner.location_reject',
    entityType: 'partner',
    entityId: partnerId,
    before: {
      location_status: before.location_status,
      latitude: before.latitude,
      longitude: before.longitude,
      location_source: before.location_source,
    },
    after: {
      location_status: after.location_status,
      location_verified_at: after.location_verified_at,
      latitude: after.latitude,
      longitude: after.longitude,
      location_source: after.location_source,
    },
    metadata: {
      name: after.name,
    },
  });

  return withRefreshedCookies(
    NextResponse.json({ ok: true, partner: after }),
    cookieCarrier
  );
}
