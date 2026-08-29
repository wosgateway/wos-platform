// src/app/api/partner/profile/route.ts
//
// PATCH /api/partner/profile
//   body: { name, description, province, logo_url, cover_image_url }
//
// Replaces CompanyProfile.tsx's old direct
// `.from('partners').update(partnersPayload)` call (see migration 065
// for why: column privileges can't tell the partner-self-update policy
// apart from the admin ALL policy since both run as `authenticated`,
// so the fix is removing the direct-table path entirely). This route
// resolves partnerId from the caller's own session -- exactly like
// migration 060's ownership fix -- and never trusts a partner_id from
// the request body. `status` and every other partners column stay
// untouchable from here because they simply aren't parameters on the
// RPC this calls.
//
// Note: this route only syncs the public.partners row. The
// organizations row (source of truth for the rest of the form) is
// still updated by CompanyProfile.tsx directly, unchanged -- that
// table's own RLS ("Users can update their own organization",
// id = current_user_organization_id()) already scopes correctly and
// isn't part of this finding.

import { NextResponse } from 'next/server';
import { getPartnerSession } from '@/lib/partner/auth';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

interface PatchBody {
  name?: string;
  description?: string | null;
  province?: string | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
}

export async function PATCH(request: Request) {
  const cookieCarrier = new NextResponse();

  const { user } = await getPartnerSession(cookieCarrier);
  if (!user) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      cookieCarrier
    );
  }

  const partnerId = user.branch?.partner_id ?? null;
  if (!partnerId) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'No partner linked to this account' }, { status: 403 }),
      cookieCarrier
    );
  }

  const body: PatchBody = await request.json().catch(() => ({}));

  const service = createServiceClient();
  const { data, error } = await service.rpc('partner_update_own_profile', {
    p_partner_id: partnerId,
    p_name: typeof body.name === 'string' ? body.name : '',
    p_description: body.description ?? null,
    p_province: body.province ?? null,
    p_logo_url: body.logo_url ?? null,
    p_cover_image_url: body.cover_image_url ?? null,
  });

  if (error) {
    if (error.message.includes('partner_not_found')) {
      return withRefreshedCookies(
        NextResponse.json({ error: 'Partner not found' }, { status: 404 }),
        cookieCarrier
      );
    }
    console.error('partner_update_own_profile failed:', error);
    return withRefreshedCookies(
      NextResponse.json({ error: error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  return withRefreshedCookies(NextResponse.json({ partner: data }), cookieCarrier);
}
