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

interface PortalAccessPatchBody {
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .normalize('NFKC')
    .replace(/[^a-z0-9\u0e00-\u0e7f]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'partner';
}

// GET /api/admin/partners/[id]/portal-access
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const partnerId = params.id;

  if (!partnerId?.trim()) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'ต้องระบุ partner id' }, { status: 400 }),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  const { data: branch, error: branchErr } = await supabase
    .from('branches')
    .select('id, name, email, phone, organization_id, organizations(id, name)')
    .eq('partner_id', partnerId)
    .maybeSingle();

  if (branchErr) {
    console.error('portal-access GET: branch lookup failed', branchErr);

    return withRefreshedCookies(
      NextResponse.json(
        { error: 'ตรวจสอบบัญชีที่มีอยู่ไม่สำเร็จ: ' + branchErr.message },
        { status: 500 }
      ),
      cookieCarrier
    );
  }

  if (!branch) {
    return withRefreshedCookies(
      NextResponse.json({ exists: false }),
      cookieCarrier
    );
  }

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, full_name, email, phone, is_platform_admin')
    .eq('branch_id', branch.id)
    .eq('is_platform_admin', false)
    .maybeSingle();

  if (userErr) {
    console.error('portal-access GET: user lookup failed', userErr);

    return withRefreshedCookies(
      NextResponse.json(
        { error: 'ตรวจสอบข้อมูลผู้ติดต่อไม่สำเร็จ: ' + userErr.message },
        { status: 500 }
      ),
      cookieCarrier
    );
  }

  const org = branch.organizations as unknown as {
    id: string;
    name: string;
  } | null;

  return withRefreshedCookies(
    NextResponse.json({
      exists: true,
      organizationId: org?.id ?? branch.organization_id,
      organizationName: org?.name ?? '',
      branchId: branch.id,
      branchName: branch.name ?? '',
      contactName: user?.full_name ?? '',
      contactEmail: user?.email ?? branch.email ?? '',
      contactPhone: user?.phone ?? branch.phone ?? '',
    }),
    cookieCarrier
  );
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);

  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const fail = (
    message: string,
    status = 400,
    extra?: Record<string, unknown>
  ) =>
    withRefreshedCookies(
      NextResponse.json({ error: message, ...extra }, { status }),
      cookieCarrier
    );

  const partnerId = params.id;

  if (!partnerId?.trim()) {
    return fail('ต้องระบุ partner id');
  }

  let body: Partial<PortalAccessBody>;

  try {
    body = await req.json();
  } catch {
    return fail('invalid JSON body');
  }

  const {
    organizationName,
    branchName,
    contactName,
    contactEmail,
    contactPhone,
  } = body;

  if (!organizationName?.trim()) {
    return fail('ต้องระบุชื่อองค์กร (organizationName)');
  }

  if (!branchName?.trim()) {
    return fail('ต้องระบุชื่อสาขา (branchName)');
  }

  if (!contactName?.trim()) {
    return fail('ต้องระบุชื่อผู้ติดต่อ (contactName)');
  }

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

  // Guard against double-provisioning.
  const { data: existingBranch, error: existingBranchErr } = await supabase
    .from('branches')
    .select('id, email, organization_id')
    .eq('partner_id', partnerId)
    .maybeSingle();

  if (existingBranchErr) {
    console.error(
      'portal-access: existing-branch lookup failed',
      existingBranchErr
    );

    return fail(
      'ตรวจสอบบัญชีที่มีอยู่ไม่สำเร็จ: ' + existingBranchErr.message,
      500
    );
  }

  if (existingBranch) {
    return fail(
      'พาร์ทเนอร์นี้มีบัญชีล็อกอินอยู่แล้ว — ใช้ "ขอลิงก์ใหม่" ด้วยอีเมลที่ผูกไว้ (' +
        (existingBranch.email ?? 'ไม่ทราบอีเมล') +
        ') แทนการสร้างใหม่',
      409,
      {
        existingBranchEmail: existingBranch.email ?? null,
      }
    );
  }

  // 1. organizations
  const slug = `${slugify(organizationName)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert([
      {
        name: organizationName.trim(),
        slug,
        province: partner.province ?? null,
        status: 'active',
      },
    ])
    .select('id, name, slug')
    .single();

  if (orgErr || !org) {
    console.error('portal-access: create organization failed', orgErr);

    return fail(
      'สร้าง Organization ไม่สำเร็จ: ' +
        (orgErr?.message ?? 'unknown error'),
      500
    );
  }

  // 2. branches
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

    await supabase
      .from('organizations')
      .delete()
      .eq('id', org.id);

    return fail(
      'สร้าง Branch ไม่สำเร็จ: ' +
        (branchErr?.message ?? 'unknown error'),
      500
    );
  }

  // 3. Mint Auth user + invite link without sending email.
  const redirectTo = `${new URL(req.url).origin}/th/set-password`;

  const { data: linkData, error: linkErr } =
    await supabase.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo },
    });

  if (
    linkErr ||
    !linkData?.user ||
    !linkData.properties?.action_link
  ) {
    console.error(
      'portal-access: generateLink(invite) failed',
      linkErr
    );

    await supabase
      .from('branches')
      .delete()
      .eq('id', branch.id);

    await supabase
      .from('organizations')
      .delete()
      .eq('id', org.id);

    return fail(
      'สร้างบัญชีเข้าสู่ระบบไม่สำเร็จ: ' +
        (linkErr?.message ?? 'unknown error'),
      500
    );
  }

  const authUser = linkData.user;
  const inviteLink = linkData.properties.action_link;

  // 4. public.users
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
    console.error(
      'portal-access: create public.users row failed',
      userErr
    );

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

// PATCH /api/admin/partners/[id]/portal-access
//
// Updates contact information for an existing portal account.
//
// Because Supabase Auth and public Postgres tables are separate systems,
// this cannot be one database transaction. The mutation therefore uses
// a best-effort rollback strategy:
//
//   Auth email
//      ↓
//   public.users
//      ↓
//   branches
//
// If public.users fails, Auth is rolled back.
// If branches fails, public.users and Auth are rolled back.
//
// The original values are captured before mutation so rollback does not
// depend on assumptions about the current database state.
export async function PATCH(
  req: Request,
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

  const fail = (message: string, status = 400) =>
    withRefreshedCookies(
      NextResponse.json({ error: message }, { status }),
      cookieCarrier
    );

  const partnerId = params.id;

  if (!partnerId?.trim()) {
    return fail('ต้องระบุ partner id');
  }

  let body: Partial<PortalAccessPatchBody>;

  try {
    body = await req.json();
  } catch {
    return fail('invalid JSON body');
  }

  const {
    contactName,
    contactEmail,
    contactPhone,
  } = body;

  if (!contactName?.trim()) {
    return fail('ต้องระบุชื่อผู้ติดต่อ (contactName)');
  }

  if (!contactEmail?.trim() || !contactEmail.includes('@')) {
    return fail(
      'ต้องระบุอีเมลผู้ติดต่อที่ถูกต้อง (contactEmail)'
    );
  }

  const email = contactEmail.trim();
  const phone = contactPhone?.trim() || null;

  const supabase = createServiceClient();

  // 1. Locate the branch linked to this partner.
  const { data: branch, error: branchErr } = await supabase
    .from('branches')
    .select('id, email, phone')
    .eq('partner_id', partnerId)
    .maybeSingle();

  if (branchErr) {
    console.error(
      'portal-access PATCH: branch lookup failed',
      branchErr
    );

    return fail(
      'ตรวจสอบบัญชีที่มีอยู่ไม่สำเร็จ: ' +
        branchErr.message,
      500
    );
  }

  if (!branch) {
    return fail(
      'พาร์ทเนอร์นี้ยังไม่มีบัญชีพอร์ทัล — สร้างบัญชีก่อนจึงจะแก้ไขข้อมูลผู้ติดต่อได้',
      404
    );
  }

  // 2. Locate the non-platform-admin portal user and capture all
  // original values required for rollback.
  const { data: portalUser, error: userLookupErr } =
    await supabase
      .from('users')
      .select(
        'id, full_name, email, phone, supabase_user_id'
      )
      .eq('branch_id', branch.id)
      .eq('is_platform_admin', false)
      .maybeSingle();

  if (userLookupErr) {
    console.error(
      'portal-access PATCH: user lookup failed',
      userLookupErr
    );

    return fail(
      'ตรวจสอบข้อมูลผู้ติดต่อไม่สำเร็จ: ' +
        userLookupErr.message,
      500
    );
  }

  if (!portalUser) {
    return fail(
      'ไม่พบบัญชีผู้ใช้ของพาร์ทเนอร์นี้ (ผูก branch ไว้แต่ไม่มีแถว users ตรงกัน — ต้องแก้ไขด้วยตนเอง)',
      500
    );
  }

  const emailChanged =
    email.toLowerCase() !==
    (portalUser.email ?? '').toLowerCase();

  // 3. If the email is changing, read the actual Supabase Auth
  // record first. Do not assume public.users.email is the Auth email.
  let originalAuthEmail: string | null = null;

  if (emailChanged) {
    const {
      data: authUserData,
      error: authUserLookupErr,
    } = await supabase.auth.admin.getUserById(
      portalUser.supabase_user_id
    );

    if (authUserLookupErr || !authUserData.user) {
      console.error(
        'portal-access PATCH: auth user lookup failed',
        authUserLookupErr
      );

      return fail(
        'ตรวจสอบบัญชีล็อกอินของพาร์ทเนอร์ไม่สำเร็จ — ยังไม่มีข้อมูลใดถูกเปลี่ยน',
        500
      );
    }

    originalAuthEmail =
      authUserData.user.email ?? null;

    if (!originalAuthEmail) {
      return fail(
        'ไม่พบอีเมลเดิมของบัญชีล็อกอิน — ยังไม่มีข้อมูลใดถูกเปลี่ยน',
        500
      );
    }
  }

  // 4. Update Supabase Auth first.
  if (emailChanged) {
    const {
      error: authUpdateErr,
    } = await supabase.auth.admin.updateUserById(
      portalUser.supabase_user_id,
      {
        email,
        email_confirm: true,
      }
    );

    if (authUpdateErr) {
      console.error(
        'portal-access PATCH: auth email update failed',
        authUpdateErr
      );

      return fail(
        'อัปเดตอีเมลล็อกอินไม่สำเร็จ: ' +
          authUpdateErr.message,
        500
      );
    }
  }

  // 5. Update public.users.
  const { error: userUpdateErr } =
    await supabase
      .from('users')
      .update({
        full_name: contactName.trim(),
        email,
        phone,
      })
      .eq('id', portalUser.id);

  if (userUpdateErr) {
    console.error(
      'portal-access PATCH: users update failed',
      userUpdateErr
    );

    // Roll back Auth because Auth succeeded but public.users failed.
    if (emailChanged && originalAuthEmail) {
      const {
        error: rollbackAuthErr,
      } = await supabase.auth.admin.updateUserById(
        portalUser.supabase_user_id,
        {
          email: originalAuthEmail,
          email_confirm: true,
        }
      );

      if (rollbackAuthErr) {
        console.error(
          'portal-access PATCH: AUTH ROLLBACK FAILED',
          rollbackAuthErr
        );
      }
    }

    return fail(
      'บันทึกข้อมูลผู้ติดต่อไม่สำเร็จ และระบบได้พยายามคืนค่าอีเมลล็อกอินเดิมแล้ว: ' +
        userUpdateErr.message,
      500
    );
  }

  // 6. Update branches, which contains a denormalized copy of the
  // contact email/phone used by the admin partner list.
  const {
    error: branchUpdateErr,
  } = await supabase
    .from('branches')
    .update({
      email,
      phone,
    })
    .eq('id', branch.id);

  if (branchUpdateErr) {
    console.error(
      'portal-access PATCH: branches update failed',
      branchUpdateErr
    );

    // Roll back public.users.
    const {
      error: rollbackUserErr,
    } = await supabase
      .from('users')
      .update({
        full_name: portalUser.full_name,
        email: portalUser.email,
        phone: portalUser.phone,
      })
      .eq('id', portalUser.id);

    if (rollbackUserErr) {
      console.error(
        'portal-access PATCH: USERS ROLLBACK FAILED',
        rollbackUserErr
      );
    }

    // Roll back Supabase Auth.
    if (emailChanged && originalAuthEmail) {
      const {
        error: rollbackAuthErr,
      } = await supabase.auth.admin.updateUserById(
        portalUser.supabase_user_id,
        {
          email: originalAuthEmail,
          email_confirm: true,
        }
      );

      if (rollbackAuthErr) {
        console.error(
          'portal-access PATCH: AUTH ROLLBACK FAILED',
          rollbackAuthErr
        );
      }
    }

    return fail(
      'อัปเดตข้อมูลไม่ครบ ระบบได้พยายาม rollback ข้อมูลกลับเป็นค่าเดิมแล้ว: ' +
        branchUpdateErr.message,
      500
    );
  }

  // 7. Only write the audit record after all three systems agree.
  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'partner.portal-access.update',
    entityType: 'partner',
    entityId: partnerId,
    before: {
      contactName: portalUser.full_name,
      contactEmail: portalUser.email,
      contactPhone: portalUser.phone,
    },
    after: {
      contactName: contactName.trim(),
      contactEmail: email,
      contactPhone: phone,
      emailChanged,
    },
  });

    return withRefreshedCookies(
    NextResponse.json({
      ok: true,
      contactName: contactName.trim(),
      contactEmail: email,
      contactPhone: phone,
    }),
    cookieCarrier
  );
}
