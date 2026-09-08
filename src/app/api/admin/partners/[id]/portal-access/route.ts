// src/app/api/admin/partners/[id]/portal-access/route.ts
//
// Creates a portal login for a partner that the admin added directly
// (no B2B lead/application involved) — e.g. a Transport or Hotel
// partner the admin is entering by hand. This is the "แบบที่ 2" path:
// it provisions everything needed for the partner to log in *someday*,
// but never sends an automatic email. The admin gets back a copyable
// link and decides how/when to hand it over (LINE, WhatsApp, in
// person, ...).
//
//   partners (existing row, id from the URL)
//        ^
//        |  branches.partner_id
//   organizations -> branches -> Supabase Auth (link only, no email) -> public.users
//
// Deliberately NOT the same route as /api/admin/partners/provision:
// that route is wired to a B2B lead (cases/partner_applications) and
// requires a leadId to claim — there is no lead here, just an admin
// adding a partner directly. Forcing this case through provision would
// mean inventing a fake lead row just to satisfy its claim step. This
// route is the lighter-weight sibling: no lead, no claim, and — the
// actual behavioral difference — it mints the invite link WITHOUT ever
// calling inviteUserByEmail(), so no email goes out.
//
// How "create a login but don't email it" works: generateLink({type:
// 'invite', ...}) creates the Supabase Auth user (same as
// inviteUserByEmail() would) but only returns the action link — it
// never sends anything. That's the whole trick. Once this has run,
// the user exists, so any *later* re-mint of the link must go through
// /api/admin/partners/resend-invite-link (type: 'recovery') instead —
// generateLink({type:'invite'}) errors on an email that's already a
// user.
//
// Not wrapped in a DB transaction, same reasoning as provision.ts:
// organizations/branches/users are Postgres, the Auth link is a
// separate GoTrue call. Each step best-effort cleans up what it
// already created before failing, except after the Auth user exists
// (step 4) — GoTrue has no delete-by-email undo, so that path leaves
// the auth user in place and returns `partial` ids for the admin to
// finish wiring up public.users by hand.

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface PortalAccessBody {
  organizationName: string;
  branchName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .normalize('NFKC')
    // keep latin letters/digits/Thai script, collapse everything else to "-"
    .replace(/[^a-z0-9\u0e00-\u0e7f]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'partner';
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  const fail = (message: string, status = 400, extra?: Record<string, unknown>) =>
    withRefreshedCookies(NextResponse.json({ error: message, ...extra }, { status }), cookieCarrier);

  const partnerId = params.id;
  if (!partnerId?.trim()) return fail('ต้องระบุ partner id');

  let body: Partial<PortalAccessBody>;
  try {
    body = await req.json();
  } catch {
    return fail('invalid JSON body');
  }

  const { organizationName, branchName, contactName, contactEmail, contactPhone } = body;

  if (!organizationName?.trim()) return fail('ต้องระบุชื่อองค์กร (organizationName)');
  if (!branchName?.trim()) return fail('ต้องระบุชื่อสาขา (branchName)');
  if (!contactName?.trim()) return fail('ต้องระบุชื่อผู้ติดต่อ (contactName)');
  if (!contactEmail?.trim() || !contactEmail.includes('@')) {
    return fail('ต้องระบุอีเมลผู้ติดต่อที่ถูกต้อง (contactEmail)');
  }
  const email = contactEmail.trim();

  const supabase = createServiceClient();

  // 0. Confirm the partner listing actually exists.
  const { data: partner, error: partnerErr } = await supabase
    .from('partners')
    .select('id, name, province')
    .eq('id', partnerId)
    .single();

  if (partnerErr || !partner) {
    return fail('ไม่พบพาร์ทเนอร์ที่ระบุ', 404);
  }

  // Guard against double-provisioning: if a branch is already linked to
  // this partner, this partner already has (or is mid-way through
  // getting) a portal login — creating a second organization/branch for
  // the same listing would just fragment things. Point the admin at
  // resend-invite-link instead, which re-mints a link for whichever
  // email is already on file.
  const { data: existingBranch, error: existingBranchErr } = await supabase
    .from('branches')
    .select('id, email, organization_id')
    .eq('partner_id', partnerId)
    .maybeSingle();

  if (existingBranchErr) {
    console.error('portal-access: existing-branch lookup failed', existingBranchErr);
    return fail('ตรวจสอบบัญชีที่มีอยู่ไม่สำเร็จ: ' + existingBranchErr.message, 500);
  }
  if (existingBranch) {
    return fail(
      'พาร์ทเนอร์นี้มีบัญชีล็อกอินอยู่แล้ว — ใช้ "ขอลิงก์ใหม่" ด้วยอีเมลที่ผูกไว้ (' +
        (existingBranch.email ?? 'ไม่ทราบอีเมล') +
        ') แทนการสร้างใหม่',
      409,
      { existingBranchEmail: existingBranch.email ?? null }
    );
  }

  // 1. organizations
  const slug = `${slugify(organizationName)}-${Math.random().toString(36).slice(2, 7)}`;
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert([{ name: organizationName.trim(), slug, province: partner.province ?? null, status: 'active' }])
    .select('id, name, slug')
    .single();

  if (orgErr || !org) {
    console.error('portal-access: create organization failed', orgErr);
    return fail('สร้าง Organization ไม่สำเร็จ: ' + (orgErr?.message ?? 'unknown error'), 500);
  }

  // 2. branches — linked to the existing partner listing directly at
  // creation (no separate lead/existingPartnerId indirection, unlike
  // provision.ts, since we already have the partner id from the URL).
  const { data: branch, error: branchErr } = await supabase
    .from('branches')
    .insert([
      {
        organization_id: org.id,
        partner_id: partner.id,
        name: branchName.trim(),
        province: partner.province ?? null,
        phone: contactPhone?.trim() || null,
        email,
        status: 'active',
      },
    ])
    .select('id, name')
    .single();

  if (branchErr || !branch) {
    console.error('portal-access: create branch failed', branchErr);
    await supabase.from('organizations').delete().eq('id', org.id);
    return fail('สร้าง Branch ไม่สำเร็จ: ' + (branchErr?.message ?? 'unknown error'), 500);
  }

  // 3. Mint the Auth user + link WITHOUT emailing it. This is the one
  // real difference from provision.ts: no inviteUserByEmail() call at
  // all, so no transactional email is ever sent — only a link the
  // admin can copy and hand over however they like.
  const redirectTo = `${new URL(req.url).origin}/th/set-password`;
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  });

  if (linkErr || !linkData?.user || !linkData.properties?.action_link) {
    console.error('portal-access: generateLink(invite) failed', linkErr);
    await supabase.from('branches').delete().eq('id', branch.id);
    await supabase.from('organizations').delete().eq('id', org.id);
    return fail('สร้างบัญชีเข้าสู่ระบบไม่สำเร็จ: ' + (linkErr?.message ?? 'unknown error'), 500);
  }

  const authUser = linkData.user;
  const inviteLink = linkData.properties.action_link;

  // 4. public.users row — links the new (un-emailed) auth user to
  // org/branch/role, same shape as provision.ts step 6.
  const { data: portalUser, error: userErr } = await supabase
    .from('users')
    .insert([
      {
        organization_id: org.id,
        branch_id: branch.id,
        email,
        supabase_user_id: authUser.id,
        full_name: contactName.trim(),
        phone: contactPhone?.trim() || null,
        role: 'admin',
        status: 'active',
      },
    ])
    .select('id, email')
    .single();

  if (userErr || !portalUser) {
    console.error('portal-access: create public.users row failed', userErr);
    // No rollback here on purpose — the Auth user already exists and
    // there's no delete-by-email undo. Leaving org/branch/auth-user in
    // place, `partial` below is what the admin uses to finish wiring
    // public.users up by hand instead of re-running this route (which
    // would fail on the "already invited" case at generateLink anyway).
    return fail(
      'สร้างบัญชีเข้าสู่ระบบสำเร็จ แต่ผูกกับ public.users ไม่สำเร็จ (ต้องแก้ไขด้วยตนเอง): ' +
        (userErr?.message ?? 'unknown error'),
      500,
      {
        partial: {
          organizationId: org.id,
          branchId: branch.id,
          supabaseUserId: authUser.id,
        },
        inviteLink,
      }
    );
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'partner.portal-access.create',
    entityType: 'partner',
    entityId: partner.id,
    after: {
      organizationId: org.id,
      branchId: branch.id,
      userId: portalUser.id,
      contactEmail: email,
      emailSent: false,
    },
  });

  return withRefreshedCookies(
    NextResponse.json({
      ok: true,
      organizationId: org.id,
      branchId: branch.id,
      userId: portalUser.id,
      inviteLink,
    }),
    cookieCarrier
  );
}
