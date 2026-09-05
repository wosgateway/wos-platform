// src/app/api/admin/partners/provision/route.ts
//
// Converts a B2B lead (from public.cases, service_type "[B2B]%" — the
// legacy /partner/apply flow — or from public.partner_applications —
// the /become-partner flow) into a live partner tenant:
//
//   organizations -> branches -> partners -> Supabase Auth invite -> public.users
//                                    ^                                    |
//                                    +----------- branches.partner_id ----+
//
// Then marks the source lead as converted so PartnerLeadsManager.tsx
// stops surfacing it as actionable.
//
// DELIBERATELY NOT auto-derived from the lead row's free-text fields —
// see PartnerLeadsManager.tsx's convert modal. The admin confirms every
// field (org name, branch name, category, contact email) before this
// route ever runs. A wrong column name or a guessed category here would
// create real rows (and send a real invite email) in production, so
// this route trusts the request body's *shape* (validated below) but
// never guesses values on the caller's behalf.
//
// Not wrapped in a DB transaction — public.organizations/branches/
// partners/users live in Postgres but the Auth invite is a separate
// GoTrue call, so there's no single transaction that could span both
// anyway. Each step below checks its own error and, for the Postgres
// steps, best-effort deletes what it already created before failing.
// If the failure happens after the Auth invite (step 5) there is
// nothing to roll back there — GoTrue has no delete-by-email undo — so
// that response includes `partial` ids for the admin to finish or
// clean up by hand.

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Must match the CHECK constraint on public.partners.category
// (sql/006_legacy_directory_tables.sql).
const PARTNER_CATEGORIES = ['Hospital', 'Clinic', 'Dental', 'Wellness', 'Spa', 'Hotel', 'Transport'] as const;
type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

const LEAD_SOURCES = ['case', 'partner_application'] as const;
type LeadSource = (typeof LEAD_SOURCES)[number];

interface ProvisionBody {
  leadSource: LeadSource;
  leadId: string;
  organizationName: string;
  branchName: string;
  category: PartnerCategory;
  province?: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  // Optional: link this tenant to a partner listing that already exists
  // in public.partners (e.g. a real business that was in the directory
  // before it had a login) instead of creating a new listing. Added
  // 2026-09-04 for provisioning real partners that already had test
  // orders cleaned up against their existing partner row — without this,
  // step 3 below would insert a duplicate listing for the same business
  // and disconnect it from its existing order/rating history.
  existingPartnerId?: string | null;
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

export async function POST(req: Request) {
  // "cookie carrier" — see src/lib/admin/with-refreshed-cookies.ts. Every
  // return path below goes through withRefreshedCookies(..., cookieCarrier)
  // so a mid-request token refresh isn't silently dropped.
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  const fail = (message: string, status = 400, extra?: Record<string, unknown>) =>
    withRefreshedCookies(NextResponse.json({ error: message, ...extra }, { status }), cookieCarrier);

  let body: Partial<ProvisionBody>;
  try {
    body = await req.json();
  } catch {
    return fail('invalid JSON body');
  }

  const {
    leadSource,
    leadId,
    organizationName,
    branchName,
    category,
    province,
    contactName,
    contactEmail,
    contactPhone,
    existingPartnerId,
  } = body;

  if (!leadSource || !LEAD_SOURCES.includes(leadSource)) {
    return fail(`leadSource ต้องเป็นหนึ่งใน: ${LEAD_SOURCES.join(', ')}`);
  }
  if (!leadId?.trim()) return fail('ต้องระบุ leadId');
  if (!organizationName?.trim()) return fail('ต้องระบุชื่อองค์กร (organizationName)');
  if (!branchName?.trim()) return fail('ต้องระบุชื่อสาขา (branchName)');
  if (!category || !PARTNER_CATEGORIES.includes(category)) {
    return fail(`category ต้องเป็นหนึ่งใน: ${PARTNER_CATEGORIES.join(', ')}`);
  }
  if (!contactName?.trim()) return fail('ต้องระบุชื่อผู้ติดต่อ (contactName)');
  if (!contactEmail?.trim() || !contactEmail.includes('@')) {
    return fail('ต้องระบุอีเมลผู้ติดต่อที่ถูกต้อง (contactEmail)');
  }

  const supabase = createServiceClient();

  // 0. Claim the lead atomically — this IS the double-provisioning guard,
  // not just a check.
  //
  // Schema notes (sql/006_legacy_directory_tables.sql,
  // sql/030_partner_applications.sql):
  //   - public.cases.status has NO CHECK constraint (free TEXT), so
  //     'converted_b2b' is an app-level convention only.
  //   - public.partner_applications.status DOES have a CHECK constraint:
  //     PENDING | UNDER_REVIEW | NEEDS_INFO | APPROVED | REJECTED. There
  //     is no spare "claiming/in-progress" value available here without
  //     a migration, and PartnerLeadsManager.tsx's admin dropdown can
  //     also write any of those 5 values directly, independent of this
  //     route — so a separate invented in-progress status would still
  //     race against a manual admin edit anyway.
  //
  // So instead of SELECT-then-check (the old code) or inventing a new
  // status, we flip the lead straight to its terminal "converted" value
  // as a compare-and-swap: `UPDATE ... WHERE id = X AND status = <the
  // value we just read>`. Postgres evaluates that WHERE clause against
  // the row's live value at UPDATE time (under the row lock), not the
  // earlier SELECT snapshot — so if a double-click or a second tab races
  // in with the same stale `priorStatus`, only one UPDATE can match and
  // return a row. The loser gets 0 rows back and fails closed here,
  // before any Organization/Branch/Partner/Auth invite is created.
  //
  // `priorStatus` is kept so we can best-effort restore it if a
  // downstream step fails — see restoreLeadStatus() below. Once
  // public.users is created (step 6), the invite has already gone out
  // and there's no clean undo, so that path intentionally leaves the
  // lead claimed instead of restoring it (see the comment on step 6).
  const leadTable = leadSource === 'case' ? 'cases' : 'partner_applications';
  const terminalStatus = leadSource === 'case' ? 'converted_b2b' : 'APPROVED';

  const { data: leadRow, error: leadFetchErr } = await supabase
    .from(leadTable)
    .select('id, status')
    .eq('id', leadId)
    .single();

  if (leadFetchErr || !leadRow) {
    return fail('ไม่พบ lead ต้นทางที่ระบุ (leadId/leadSource ไม่ตรงกับข้อมูลจริง)', 404);
  }

  const priorStatus = leadRow.status as string;
  if (priorStatus === terminalStatus) {
    return fail('lead นี้ถูกแปลงเป็นพันธมิตรไปแล้ว', 409);
  }

  const claimPatch: Record<string, unknown> =
    leadSource === 'case'
      ? { status: terminalStatus }
      : { status: terminalStatus, reviewed_at: new Date().toISOString() };

  const { data: claimedRows, error: claimErr } = await supabase
    .from(leadTable)
    .update(claimPatch)
    .eq('id', leadId)
    .eq('status', priorStatus) // compare-and-swap guard — this is the lock
    .select('id');

  if (claimErr) {
    console.error('provision: claim lead failed', claimErr);
    return fail('ล็อก lead เพื่อแปลงเป็นพันธมิตรไม่สำเร็จ: ' + claimErr.message, 500);
  }
  if (!claimedRows || claimedRows.length === 0) {
    // Status changed between our SELECT and this UPDATE — another
    // request (or a manual admin edit) already claimed/moved this lead.
    return fail('lead นี้ถูกแปลงเป็นพันธมิตรไปแล้ว หรือกำลังถูกแก้ไขโดยคำขออื่นพร้อมกัน กรุณารีเฟรชแล้วลองใหม่', 409);
  }

  // Best-effort compensating action: put the lead's status back the way
  // it was if we bail out before public.users exists. Guarded so it only
  // ever runs once. Also a compare-and-swap (`WHERE status = terminalStatus`)
  // for the same reason the claim itself is: if an admin manually changes
  // the lead's status (PartnerLeadsManager.tsx's dropdown writes directly
  // to this row, independent of this route) in the window between our
  // claim and this restore, we must not stomp on that edit — only revert
  // if the row still shows exactly what we set it to.
  let leadRestored = false;
  async function restoreLeadStatus() {
    if (leadRestored) return;
    leadRestored = true;

    const { data: restoredRows, error: restoreErr } = await supabase
      .from(leadTable)
      .update({ status: priorStatus })
      .eq('id', leadId)
      .eq('status', terminalStatus) // don't overwrite a status someone else set since our claim
      .select('id');

    if (restoreErr) {
      console.error('provision: restoring lead status after failed provisioning failed', restoreErr);
      return;
    }
    if (!restoredRows || restoredRows.length === 0) {
      // Status was changed (e.g. by an admin) between our claim and this
      // restore — leave it as-is rather than overwrite that edit.
      console.error('provision: lead status was changed before restore; leaving current status untouched', {
        leadId,
        leadSource,
        priorStatus,
        terminalStatus,
      });
    }
  }

  // 1. organizations
  const slug = `${slugify(organizationName)}-${Math.random().toString(36).slice(2, 7)}`;
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert([{ name: organizationName.trim(), slug, province: province?.trim() || null, status: 'active' }])
    .select('id, name, slug')
    .single();

  if (orgErr || !org) {
    console.error('provision: create organization failed', orgErr);
    await restoreLeadStatus();
    return fail('สร้าง Organization ไม่สำเร็จ: ' + (orgErr?.message ?? 'unknown error'), 500);
  }

  // 2. branches
  const { data: branch, error: branchErr } = await supabase
    .from('branches')
    .insert([
      {
        organization_id: org.id,
        name: branchName.trim(),
        province: province?.trim() || null,
        phone: contactPhone?.trim() || null,
        email: contactEmail.trim(),
        status: 'active',
      },
    ])
    .select('id, name')
    .single();

  if (branchErr || !branch) {
    console.error('provision: create branch failed', branchErr);
    await supabase.from('organizations').delete().eq('id', org.id);
    await restoreLeadStatus();
    return fail('สร้าง Branch ไม่สำเร็จ: ' + (branchErr?.message ?? 'unknown error'), 500);
  }

  // 3. partners (public directory listing) — reuse an existing listing
  // when existingPartnerId is given (real business already in the
  // directory), otherwise create a new one as before. `createdPartner`
  // tracks which case we're in so the rollback paths below only ever
  // delete a partner row this request itself created — never someone's
  // pre-existing listing.
  let partner: { id: string; name: string };
  let createdPartner = false;

  if (existingPartnerId?.trim()) {
    const { data: existing, error: existingErr } = await supabase
      .from('partners')
      .select('id, name')
      .eq('id', existingPartnerId.trim())
      .single();

    if (existingErr || !existing) {
      console.error('provision: existingPartnerId lookup failed', existingErr);
      await restoreLeadStatus();
      return fail('ไม่พบ partner listing ที่ระบุ (existingPartnerId ไม่ตรงกับข้อมูลจริง)', 404);
    }
    partner = existing;
  } else {
    const { data: newPartner, error: partnerErr } = await supabase
      .from('partners')
      .insert([
        {
          name: organizationName.trim(),
          category,
          province: province?.trim() || null,
          status: 'active',
        },
      ])
      .select('id, name')
      .single();

    if (partnerErr || !newPartner) {
      console.error('provision: create partner listing failed', partnerErr);
      await supabase.from('branches').delete().eq('id', branch.id);
      await supabase.from('organizations').delete().eq('id', org.id);
      await restoreLeadStatus();
      return fail('สร้าง Partner listing ไม่สำเร็จ: ' + (partnerErr?.message ?? 'unknown error'), 500);
    }
    partner = newPartner;
    createdPartner = true;
  }

  // 4. link branch -> partner listing (current_user_partner_id() / getPartnerSession()
  // both depend on branches.partner_id — see sql/072_add_branches_partner_id.sql)
  const { error: linkErr } = await supabase.from('branches').update({ partner_id: partner.id }).eq('id', branch.id);
  if (linkErr) {
    console.error('provision: link branch -> partner failed', linkErr);
    if (createdPartner) await supabase.from('partners').delete().eq('id', partner.id);
    await supabase.from('branches').delete().eq('id', branch.id);
    await supabase.from('organizations').delete().eq('id', org.id);
    await restoreLeadStatus();
    return fail('เชื่อม Branch กับ Partner listing ไม่สำเร็จ: ' + linkErr.message, 500);
  }

  // 5. Supabase Auth invite — sends the "set your password" email;
  // landing page is /set-password (src/app/[locale]/set-password/page.tsx).
  //
  // MUST include the /th/ locale prefix here, not just "/set-password".
  // routing.ts has no localePrefix override, so next-intl defaults to
  // 'always' and a bare /set-password would itself 302-redirect to
  // /th/set-password before this page ever renders. Browsers do carry
  // the URL's hash fragment (#access_token=...) across that kind of
  // redirect since the Location header has no fragment of its own — so
  // this wasn't actually broken — but relying on that extra hop is
  // fragile: some in-app/webview browsers (Gmail app, LINE, etc.) that
  // partners may open the invite email in don't preserve fragments
  // reliably across a redirect. Sending them straight to the real,
  // locale-prefixed URL removes that hop entirely. Partner portal is
  // intentionally Thai-only (see middleware.ts), so 'th' is hardcoded
  // rather than read from routing.defaultLocale.
  const redirectTo = `${new URL(req.url).origin}/th/set-password`;
  const { data: invite, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(contactEmail.trim(), {
    redirectTo,
  });

  // Best-effort: also mint the actual clickable link so the admin can
  // copy/send it by hand (LINE, WhatsApp, a second email client, ...)
  // instead of relying solely on Supabase's transactional email actually
  // landing in the partner's inbox. inviteUserByEmail() above only
  // returns the user object, never the link itself — the link has to be
  // fetched separately via generateLink(). Can't reuse type: 'invite'
  // here since the user this just created via inviteUserByEmail already
  // exists, and generateLink({type:'invite'}) errors on an existing
  // user; type: 'recovery' is the one GoTrue type meant for "get a link
  // for a user that already exists," and it produces the same
  // #access_token/refresh_token hash shape that /th/set-password reads
  // (see that page's header comment — it never inspects `type`, only the
  // tokens). A failure here must NOT fail the whole provision — the
  // invite email has already gone out at this point.
  let inviteLink: string | null = null;
  if (invite?.user) {
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: contactEmail.trim(),
      options: { redirectTo },
    });
    if (linkErr) {
      console.error('provision: generateLink (copyable invite link) failed — email invite still sent', linkErr);
    } else {
      inviteLink = linkData?.properties?.action_link ?? null;
    }
  }

  if (inviteErr || !invite?.user) {
    console.error('provision: auth invite failed', inviteErr);
    if (createdPartner) await supabase.from('partners').delete().eq('id', partner.id);
    await supabase.from('branches').delete().eq('id', branch.id);
    await supabase.from('organizations').delete().eq('id', org.id);
    await restoreLeadStatus();
    return fail('ส่งคำเชิญ (Supabase Auth) ไม่สำเร็จ: ' + (inviteErr?.message ?? 'unknown error'), 500);
  }

  // 6. public.users row — links the invited auth user to org/branch/role.
  const { data: portalUser, error: userErr } = await supabase
    .from('users')
    .insert([
      {
        organization_id: org.id,
        branch_id: branch.id,
        email: contactEmail.trim(),
        supabase_user_id: invite.user.id,
        full_name: contactName.trim(),
        phone: contactPhone?.trim() || null,
        role: 'admin',
        status: 'active',
      },
    ])
    .select('id, email')
    .single();

  if (userErr || !portalUser) {
    console.error('provision: create public.users row failed', userErr);
    // No rollback here on purpose: the Auth invite already went out and
    // there is no undo for that. Deleting org/branch/partner now would
    // leave a live invite pointing at nothing, which is worse than
    // leaving all rows in place for the admin to fix directly.
    //
    // Same reasoning applies to the lead's status: we deliberately do
    // NOT call restoreLeadStatus() here. Org/Branch/Partner/invite all
    // exist for real at this point, so the lead genuinely has been
    // converted (just incompletely) — restoring priorStatus would make
    // PartnerLeadsManager.tsx's "Convert to Partner" button clickable
    // again and let an admin re-run this whole route on top of the
    // tenant that already exists, creating a second Org/Branch/Partner/
    // invite for the same lead. Leaving status = terminalStatus keeps
    // the button disabled; the `partial` ids below are what the admin
    // uses to finish wiring public.users up by hand instead.
    return fail(
      'สร้าง public.users ไม่สำเร็จ (คำเชิญ Supabase Auth ถูกส่งไปแล้ว — ต้องแก้ไขด้วยตนเอง): ' +
        (userErr?.message ?? 'unknown error'),
      500,
      {
        partial: {
          organizationId: org.id,
          branchId: branch.id,
          partnerId: partner.id,
          supabaseUserId: invite.user.id,
        },
      }
    );
  }

  // Lead is already marked converted — that happened atomically in the
  // claim at step 0, not here. (Previously this was a separate final
  // UPDATE whose result was never checked — a failure here would have
  // silently left the lead "actionable" while a real tenant already
  // existed for it, letting an admin re-click Convert and duplicate
  // everything above.)

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'partner.provision',
    entityType: 'organization',
    entityId: org.id,
    after: {
      organizationId: org.id,
      branchId: branch.id,
      partnerId: partner.id,
      partnerListingReused: !createdPartner,
      userId: portalUser.id,
      contactEmail: contactEmail.trim(),
    },
    metadata: { leadSource, leadId },
  });

  return withRefreshedCookies(
    NextResponse.json({
      ok: true,
      organizationId: org.id,
      branchId: branch.id,
      partnerId: partner.id,
      userId: portalUser.id,
      // null if generateLink best-effort step above failed — the email
      // invite itself was still sent either way, so the frontend should
      // treat this as "nice to have," not the only way the partner gets in.
      inviteLink,
    }),
    cookieCarrier
  );
}
