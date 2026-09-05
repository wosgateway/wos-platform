// src/app/api/admin/partners/[id]/hard-delete/route.ts
//
// Real, permanent deletion of a partner tenant — Organization, Branch(es),
// Partner listing, public.users row(s), and the underlying Supabase Auth
// account(s). This is the dangerous action the old PartnersManager.tsx
// hard `.delete()` used to do (see suspend/route.ts's header comment for
// the 2026-09-04 near-miss that got it removed). It's back here, but
// scoped tightly: locked to partners with zero real order_items, zero
// real packages, AND zero real reviews, exactly as agreed —
// "ล็อคไว้เฉพาะ partner ที่ไม่มี order จริง" — extended twice since:
// once to packages, once to reviews.
//
// GET  -> precheck report: what exists under this partner, and whether
//         deletion is allowed. Never mutates anything. The frontend uses
//         this to render the confirmation dialog (and its counts) before
//         the admin has to type the partner's name to proceed. Stays a
//         plain TS read — no lock needed for a report that doesn't mutate.
// DELETE -> calls sql/075_admin_hard_delete_partner.sql, a SECURITY
//         DEFINER RPC that does the entire DB side — resolving the
//         organization/branch/user graph, re-verifying ownership AND the
//         order_items/packages/reviews = 0 business rules, and deleting
//         users/branches/organizations/partner — inside one Postgres
//         transaction under a row lock taken on the partner first. The
//         GET report above is never trusted as authorization for this;
//         the RPC re-derives and re-checks everything itself from
//         partner_id alone.
//
// Moved to an RPC (2026-09) after review flagged two P0s in the old
// TS-level implementation:
//   - TOCTOU: order_items/packages/reviews were counted, then four
//     separate DELETE statements ran afterward, in four separate round
//     trips. Nothing stopped a concurrent INSERT from landing in that
//     window. The RPC closes this by taking FOR UPDATE on the partner
//     row before checking anything — see 075's header for why that
//     blocks concurrent inserts that FK-reference this partner.
//   - Ownership trust: the route resolved orgs/branches once and passed
//     those ids into delete calls without re-deriving or re-checking
//     them at delete time. The RPC never accepts ids as input; it
//     re-resolves the graph from partner_id alone and explicitly rejects
//     if any resolved organization or branch is owned by a DIFFERENT
//     partner.
//   - (round 2) users referenced from OTHER partners' packages/reviews.
//     packages.submitted_by / reviews.moderated_by -> users.id are NO
//     ACTION and not partner-scoped, so a package/review belonging to a
//     different partner can still block this partner's user deletion.
//     The RPC checks this against the resolved user set specifically
//     (not just this partner's own package/review counts) and rejects
//     with 'blocked_user_references' rather than surfacing a raw FK
//     violation mid-transaction.
//
// What this route still owns, deliberately (none of it belongs in SQL):
//   - requireAdmin() — the RPC has no session context and trusts its
//     caller completely; it is service_role-only (see 075's REVOKE/GRANT)
//     and this check is the only authorization gate in front of it.
//   - Supabase Auth user deletion — no plpgsql access to the Auth Admin
//     API. Runs AFTER the RPC commits, using the supabaseUserId list the
//     RPC returns (captured server-side before the users rows were
//     deleted — the only remaining copy of that mapping once
//     public.users is gone, which was the original recovery-handle gap).
//     Best-effort per user; a 404 (Auth user already absent — an
//     already-deleted or never-confirmed invite) is treated as a
//     harmless already-done end state, tracked separately from a real
//     failure (network/500/rate-limit/permission), which still counts
//     against authFailed and is logged for manual follow-up — these two
//     outcomes were previously conflated into one counter.
//   - audit_log write — happens after BOTH the DB deletion and the Auth
//     cleanup attempt, so the recorded outcome is accurate: DB tenant
//     deletion completed does not imply Auth cleanup had zero failures,
//     and the log/response now say so explicitly instead of claiming
//     "fully gone (DB + Auth)" regardless of authFailed.
import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { logAdminAction } from '@/lib/admin/audit-log';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Resolves every organization/branch/user row entangled with this
// partner, however it's linked (branches.partner_id per 072,
// organizations.partner_id per 010 — a given tenant may only have one
// of the two populated depending on when it was provisioned, so both
// are checked and unioned). GET-only now — DELETE's RPC re-derives this
// itself server-side and does not trust this function's output.
async function resolveEntanglement(supabase: ReturnType<typeof createServiceClient>, partnerId: string) {
  const { data: branchesByPartner, error: branchesErr } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('partner_id', partnerId);
  if (branchesErr) throw new Error('branches lookup failed: ' + branchesErr.message);

  const { data: orgsByPartner, error: orgsErr } = await supabase
    .from('organizations')
    .select('id')
    .eq('partner_id', partnerId);
  if (orgsErr) throw new Error('organizations lookup failed: ' + orgsErr.message);

  const orgIds = new Set<string>();
  (branchesByPartner ?? []).forEach((b) => {
    if (b.organization_id) orgIds.add(b.organization_id);
  });
  (orgsByPartner ?? []).forEach((o) => orgIds.add(o.id));

  const orgIdList = Array.from(orgIds);

  // A second pass: organizations found above may have MORE branches
  // than the ones that happen to carry partner_id (e.g. legacy rows
  // from before 072), so pull every branch under those orgs too.
  const allBranchIds = new Set<string>((branchesByPartner ?? []).map((b) => b.id));
  if (orgIdList.length > 0) {
    const { data: orgBranches, error: orgBranchesErr } = await supabase
      .from('branches')
      .select('id')
      .in('organization_id', orgIdList);
    if (orgBranchesErr) throw new Error('org branches lookup failed: ' + orgBranchesErr.message);
    (orgBranches ?? []).forEach((b) => allBranchIds.add(b.id));
  }
  const branchIdList = Array.from(allBranchIds);

  let users: { id: string; email: string; supabase_user_id: string | null }[] = [];
  if (orgIdList.length > 0 || branchIdList.length > 0) {
    const orFilters: string[] = [];
    if (orgIdList.length > 0) orFilters.push(`organization_id.in.(${orgIdList.join(',')})`);
    if (branchIdList.length > 0) orFilters.push(`branch_id.in.(${branchIdList.join(',')})`);
    const { data: usersData, error: usersErr } = await supabase
      .from('users')
      .select('id, email, supabase_user_id')
      .or(orFilters.join(','));
    if (usersErr) throw new Error('users lookup failed: ' + usersErr.message);
    users = usersData ?? [];
  }

  return { orgIdList, branchIdList, users };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();
  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  const partnerId = params.id;
  const supabase = createServiceClient();

  const { data: partner, error: partnerErr } = await supabase
    .from('partners')
    .select('id, name, category, status')
    .eq('id', partnerId)
    .single();
  if (partnerErr || !partner) {
    return withRefreshedCookies(NextResponse.json({ error: 'ไม่พบพาร์ทเนอร์นี้' }, { status: 404 }), cookieCarrier);
  }

  try {
    const { orgIdList, branchIdList, users } = await resolveEntanglement(supabase, partnerId);

    const { count: orderItemsCount, error: orderItemsErr } = await supabase
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partnerId);
    if (orderItemsErr) throw new Error('order_items count failed: ' + orderItemsErr.message);

    const { count: depositRulesCount } = await supabase
      .from('deposit_rules')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partnerId);

    const { count: settlementsCount } = await supabase
      .from('settlements')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partnerId);

    // packages.partner_id -> partners(id) ON DELETE CASCADE (verified
    // live, 2026-09 — see file header). Filter directly on partnerId;
    // orgIdList is irrelevant here since packages was never linked to
    // organizations in the live schema.
    const { count: packagesCountRaw, error: packagesErr } = await supabase
      .from('packages')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partnerId);
    if (packagesErr) throw new Error('packages count failed: ' + packagesErr.message);
    const packagesCount = packagesCountRaw ?? 0;

    // reviews.partner_id -> partners(id) has NO ON DELETE clause at all
    // (verified live, 2026-09 via pg_constraint) — Postgres default is
    // NO ACTION. Treated as a blocker (same reasoning as packages):
    // review history is a business record, hard-delete shouldn't decide
    // to destroy or orphan it silently.
    const { count: reviewsCountRaw, error: reviewsErr } = await supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partnerId);
    if (reviewsErr) throw new Error('reviews count failed: ' + reviewsErr.message);
    const reviewsCount = reviewsCountRaw ?? 0;

    // Non-blocking: these all CASCADE from organizations (verified live)
    // and were never surfaced to the admin at all before now. Deleting
    // organizations silently takes them with it. Not gated — that would
    // block far more deletions than the agreed scope intends — but the
    // admin should see real counts before confirming.
    let patientsCount = 0;
    let documentsCount = 0;
    let subscriptionsCount = 0;
    if (orgIdList.length > 0) {
      const [patientsRes, documentsRes, subscriptionsRes] = await Promise.all([
        supabase.from('patients').select('id', { count: 'exact', head: true }).in('organization_id', orgIdList),
        supabase.from('documents').select('id', { count: 'exact', head: true }).in('organization_id', orgIdList),
        supabase.from('subscriptions').select('id', { count: 'exact', head: true }).in('organization_id', orgIdList),
      ]);
      if (patientsRes.error) throw new Error('patients count failed: ' + patientsRes.error.message);
      if (documentsRes.error) throw new Error('documents count failed: ' + documentsRes.error.message);
      if (subscriptionsRes.error) throw new Error('subscriptions count failed: ' + subscriptionsRes.error.message);
      patientsCount = patientsRes.count ?? 0;
      documentsCount = documentsRes.count ?? 0;
      subscriptionsCount = subscriptionsRes.count ?? 0;
    }

    const canDelete = (orderItemsCount ?? 0) === 0 && packagesCount === 0 && reviewsCount === 0;
    const blockingReasons: string[] = [];
    if ((orderItemsCount ?? 0) > 0) {
      blockingReasons.push(`มี order_items จริงผูกอยู่ ${orderItemsCount} รายการ`);
    }
    if (packagesCount > 0) {
      blockingReasons.push(`มี packages จริงผูกอยู่ ${packagesCount} รายการ`);
    }
    if (reviewsCount > 0) {
      blockingReasons.push(`มี reviews จริงผูกอยู่ ${reviewsCount} รายการ`);
    }

    return withRefreshedCookies(
      NextResponse.json({
        partner: { id: partner.id, name: partner.name, category: partner.category, status: partner.status },
        canDelete,
        blockingReason: canDelete ? null : `${blockingReasons.join(' และ ')} — ลบถาวรไม่ได้ ใช้ "ระงับ" แทน`,
        willDelete: {
          organizations: orgIdList.length,
          branches: branchIdList.length,
          portalUsers: users.length,
          depositRules: depositRulesCount ?? 0,
          settlements: settlementsCount ?? 0,
          packages: packagesCount,
          reviews: reviewsCount,
        },
        warnings: {
          patients: patientsCount,
          documents: documentsCount,
          subscriptions: subscriptionsCount,
        },
      }),
      cookieCarrier
    );
  } catch (err) {
    console.error('hard-delete precheck failed', err);
    return withRefreshedCookies(
      NextResponse.json({ error: 'ตรวจสอบข้อมูลไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)) }, { status: 500 }),
      cookieCarrier
    );
  }
}

type RpcDeletedUser = { id: string; email: string; supabaseUserId: string | null };

type RpcResult = {
  partnerId: string;
  deletedOrganizations: string[];
  deletedBranches: string[];
  deletedUsers: RpcDeletedUser[];
  partnerSnapshot: { name: string; category: string; status: string };
};

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();
  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  const partnerId = params.id;
  const supabase = createServiceClient();

  // The RPC re-locks and re-resolves everything itself and is the only
  // thing that decides whether deletion actually happens — this call is
  // purely so a 404 response can name the partner, and so the audit
  // log's `before` snapshot has something even if the RPC's own
  // partnerSnapshot were ever missing for some reason.
  const { data: partnerPreview } = await supabase
    .from('partners')
    .select('id, name, category, status')
    .eq('id', partnerId)
    .maybeSingle();

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('admin_hard_delete_partner', {
    p_partner_id: partnerId,
  });

  if (rpcErr) {
    const message = rpcErr.message ?? '';
    if (message.includes('partner_not_found')) {
      return withRefreshedCookies(NextResponse.json({ error: 'ไม่พบพาร์ทเนอร์นี้' }, { status: 404 }), cookieCarrier);
    }
    if (message.includes('ownership_conflict')) {
      console.error('hard-delete: ownership conflict, refused', { partnerId, message });
      return withRefreshedCookies(
        NextResponse.json(
          { error: `พบข้อมูลที่เป็นของพาร์ทเนอร์อื่นพ่วงอยู่ — ลบไม่ได้ (${message})` },
          { status: 409 }
        ),
        cookieCarrier
      );
    }
    if (
      message.includes('blocked_order_items') ||
      message.includes('blocked_packages') ||
      message.includes('blocked_reviews')
    ) {
      return withRefreshedCookies(
        NextResponse.json(
          { error: `มีข้อมูลจริงผูกอยู่ — ลบถาวรไม่ได้ ใช้ "ระงับ" แทน (${message})` },
          { status: 409 }
        ),
        cookieCarrier
      );
    }
    if (message.includes('blocked_user_references')) {
      // A package or review belonging to a DIFFERENT partner references
      // one of this partner's users via submitted_by/moderated_by — see
      // 075's file header. Not something the admin can resolve by
      // suspending instead; needs manual data cleanup on the referencing
      // row first.
      console.error('hard-delete: blocked on cross-partner user reference', { partnerId, message });
      return withRefreshedCookies(
        NextResponse.json(
          { error: `มี package/review ของพาร์ทเนอร์อื่นอ้างอิงผู้ใช้ในพาร์ทเนอร์นี้อยู่ — ลบถาวรไม่ได้ (${message})` },
          { status: 409 }
        ),
        cookieCarrier
      );
    }
    console.error('hard-delete RPC failed', rpcErr);
    return withRefreshedCookies(
      NextResponse.json({ error: 'ลบไม่สำเร็จ: ' + message }, { status: 500 }),
      cookieCarrier
    );
  }

  // DB side is now fully committed: organizations, branches, users, and
  // the partner row are all gone, atomically, inside the RPC. Everything
  // from here down is best-effort Auth cleanup, which cannot be part of
  // that same transaction (it's an Admin API HTTP call, not SQL) — so a
  // failure here does NOT mean the DB deletion is incomplete, only that
  // an orphaned Auth account may remain. Tracked per-user, with the Auth
  // UUID preserved in the audit record either way, precisely so that's
  // recoverable afterward.
  const result = rpcResult as RpcResult;
  const deletedUsers = result?.deletedUsers ?? [];

  const authDeleted: { supabaseUserId: string; email: string }[] = [];
  const authAlreadyAbsent: { supabaseUserId: string; email: string }[] = [];
  const authFailed: { supabaseUserId: string; email: string; error: string }[] = [];

  for (const u of deletedUsers) {
    if (!u.supabaseUserId) continue;
    const { error: delAuthErr } = await supabase.auth.admin.deleteUser(u.supabaseUserId);
    if (!delAuthErr) {
      authDeleted.push({ supabaseUserId: u.supabaseUserId, email: u.email });
      continue;
    }
    // A 404 here means the Auth user is already gone (an already-deleted
    // or never-confirmed invite) — that IS the desired end state, not a
    // failure, so it's tracked separately rather than folded into
    // authFailed. Anything else (network, 500, rate limit, permission)
    // is a genuine cleanup failure and stays recoverable via the
    // supabaseUserId captured above.
    const status = (delAuthErr as { status?: number }).status;
    if (status === 404) {
      authAlreadyAbsent.push({ supabaseUserId: u.supabaseUserId, email: u.email });
    } else {
      authFailed.push({ supabaseUserId: u.supabaseUserId, email: u.email, error: delAuthErr.message });
      console.error('hard-delete: Auth cleanup failed', { supabaseUserId: u.supabaseUserId, err: delAuthErr });
    }
  }

  await logAdminAction({
    actorUserId: auth.user.id,
    actorEmail: auth.user.email,
    action: 'partner.hard_delete',
    entityType: 'partner',
    entityId: partnerId,
    before: partnerPreview
      ? { name: partnerPreview.name, category: partnerPreview.category, status: partnerPreview.status }
      : result?.partnerSnapshot ?? null,
    metadata: {
      // DB tenant deletion has completed; Auth cleanup may still have
      // failures — see authCleanup.failed, not implied "fully gone."
      deletedOrganizations: result?.deletedOrganizations ?? [],
      deletedBranches: result?.deletedBranches ?? [],
      deletedUsers,
      authCleanup: {
        deleted: authDeleted,
        alreadyAbsent: authAlreadyAbsent,
        failed: authFailed,
      },
    },
  });

  return withRefreshedCookies(
    NextResponse.json({
      ok: true,
      authCleanup: {
        deleted: authDeleted.length,
        alreadyAbsent: authAlreadyAbsent.length,
        failed: authFailed.length,
      },
    }),
    cookieCarrier
  );
}
