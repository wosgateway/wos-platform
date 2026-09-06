// src/app/api/admin/partners/[id]/suspend/route.ts

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
      NextResponse.json(
        { error: auth.message },
        { status: auth.status }
      ),
      cookieCarrier
    );
  }

  const partnerId = params.id;

  let body: { status?: 'active' | 'inactive' };

  try {
    body = await request.json();
  } catch {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'invalid JSON body' },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  if (
    body.status !== 'active' &&
    body.status !== 'inactive'
  ) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: "status ต้องเป็น 'active' หรือ 'inactive'" },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  const { data: before, error: fetchErr } = await supabase
    .from('partners')
    .select('id, name, status')
    .eq('id', partnerId)
    .single();

  if (fetchErr || !before) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'ไม่พบพาร์ทเนอร์นี้' },
        { status: 404 }
      ),
      cookieCarrier
    );
  }

  if (before.status === body.status) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'partner already has this status' },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  const { data: after, error: updateErr } = await supabase
    .from('partners')
    .update({ status: body.status })
    .eq('id', partnerId)
    .select('id, name, status')
    .single();

  if (updateErr || !after) {
    return withRefreshedCookies(
      NextResponse.json(
        {
          error:
            'อัปเดตสถานะไม่สำเร็จ: ' +
            (updateErr?.message ?? 'unknown error'),
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
      body.status === 'inactive'
        ? 'partner.suspend'
        : 'partner.reactivate',
    entityType: 'partner',
    entityId: partnerId,
    before: {
      status: before.status,
    },
    after: {
      status: after.status,
    },
    metadata: {
      name: after.name,
    },
  });

  return withRefreshedCookies(
    NextResponse.json({
      ok: true,
      partner: after,
    }),
    cookieCarrier
  );
}