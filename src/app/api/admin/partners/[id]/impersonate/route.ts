// src/app/api/admin/partners/[id]/impersonate/route.ts
//
// "ดูแทนพาร์ทเนอร์" — lets a platform admin open the partner portal
// as if they were signed in as that partner, to debug/support without
// asking the partner for their password.
//
// How it actually signs the admin in as the partner: this does NOT try
// to fake a session client-side. It calls supabase.auth.admin.
// generateLink({ type: 'magiclink' }) with the service-role client —
// the exact same GoTrue mechanism already used for the invite email in
// /api/admin/partners/provision/route.ts, just generated on demand
// instead of emailed. That returns a real action_link; visiting it logs
// the browser in as that partner_portal user for real (sets the
// sb-wos-partner cookie via /th/impersonate-consume, see that page's
// comment for why a dedicated public landing page is needed).
//
// This is a REAL session takeover, not a read-only view — anything the
// admin does after this while "impersonating" is genuinely done as that
// partner user. Treat the resulting action_link like a password: it is
// only returned once, directly to the already-authenticated admin, and
// is not persisted anywhere. The action itself is always audit-logged
// (action: 'partner.impersonate') regardless of whether the admin ends
// up actually opening the link.
//
// Target user resolution: partners.id has no direct FK to public.users.
// The real path is partners <- organizations.partner_id <- users.
// organization_id (see sql/010_link_partners_to_payment_engine.sql's
// comment on organizations.partner_id). If the partner has no linked
// organization yet (not onboarded to the portal) or no active portal
// user, this 400s with a message explaining why instead of a generic
// error — this is the second most common reason this route would fail
// after "not authorized", so callers shouldn't have to guess.

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  const partnerId = params.id;

  let body: { targetUserId?: string } = {};
  try {
    body = await request.json();
  } catch {
    // body is optional — no targetUserId means "auto-pick".
  }

  const supabase = createServiceClient();

  const { data: partner, error: partnerErr } = await supabase
    .from('partners')
    .select('id, name')
    .eq('id', partnerId)
    .single();

  if (partnerErr || !partner) {
    return withRefreshedCookies(NextResponse.json({ error: 'ไม่พบพาร์ทเนอร์นี้' }, { status: 404 }), cookieCarrier);
  }

  // NOTE: the actual portal-login link is partners <- branches.partner_id
  // <- users.branch_id/organization_id — NOT organizations.partner_id.
  // See sql/072_add_branches_partner_id.sql: current_user_partner_id()
  // and getPartnerSession() (src/lib/partner/auth.ts) both resolve the
  // partner via branches.partner_id, and provision/route.ts (step 4)
  // only ever writes branches.partner_id, never organizations.partner_id.
  // organizations.partner_id (migration 010) is a separate column used
  // only by the order_items/settlements RLS policies and is never
  // populated by provision — querying it here always misses, which is
  // why this route previously 400'd on every properly-provisioned
  // partner with "ยังไม่ผ่านขั้นตอน provision" even when it had.
  const { data: branch, error: branchErr } = await supabase
    .from('branches')
    .select('id, organization_id, created_at, organizations ( id, name )')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (branchErr) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'ค้นหาบัญชีพอร์ทัลไม่สำเร็จ: ' + branchErr.message }, { status: 500 }),
      cookieCarrier
    );
  }

  // postgrest-js infers the embedded relation's type as an array even
  // though `organizations` is a many-to-one FK and runtime always
  // returns a single object — same cast pattern as getPartnerSession()
  // in src/lib/partner/auth.ts.
  const org = branch ? ((branch.organizations as unknown as { id: string; name: string } | null) ?? null) : null;

  if (!branch || !org) {
    return withRefreshedCookies(
      NextResponse.json({ error: `"${partner.name}" ยังไม่มีบัญชีพอร์ทัล (ยังไม่ผ่านขั้นตอน provision)` }, { status: 400 }),
      cookieCarrier
    );
  }

  // Candidate portal users for this org, active only. Prefer an 'admin'
  // role user (most representative of "the partner"); fall back to
  // whichever active user is oldest if the admin explicitly picked one
  // via targetUserId, or if no admin-role user exists.
  const { data: candidates, error: usersErr } = await supabase
    .from('users')
    .select('id, email, full_name, role, status')
    .eq('organization_id', org.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (usersErr) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'ค้นหาผู้ใช้พอร์ทัลไม่สำเร็จ: ' + usersErr.message }, { status: 500 }),
      cookieCarrier
    );
  }

  if (!candidates || candidates.length === 0) {
    return withRefreshedCookies(
      NextResponse.json({ error: `"${partner.name}" ยังไม่มีผู้ใช้พอร์ทัลที่ active` }, { status: 400 }),
      cookieCarrier
    );
  }

  const targetUser =
    (body.targetUserId ? candidates.find((u) => u.id === body.targetUserId) : undefined) ??
    candidates.find((u) => u.role === 'admin') ??
    candidates[0];

  const origin = new URL(request.url).origin;
  const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: targetUser.email,
    options: {
      redirectTo: `${origin}/th/impersonate-consume`,
    },
  });

  if (linkErr || !link?.properties?.action_link) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'สร้างลิงก์เข้าสู่ระบบแทนไม่สำเร็จ: ' + (linkErr?.message ?? 'unknown error') }, { status: 500 }),
      cookieCarrier
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'partner.impersonate',
    entityType: 'partner',
    entityId: partnerId,
    metadata: {
      partnerName: partner.name,
      organizationId: org.id,
      targetUserId: targetUser.id,
      targetUserEmail: targetUser.email,
      targetUserRole: targetUser.role,
    },
  });

  return withRefreshedCookies(
    NextResponse.json({
      ok: true,
      actionLink: link.properties.action_link,
      impersonating: { id: targetUser.id, email: targetUser.email, full_name: targetUser.full_name },
    }),
    cookieCarrier
  );
}
