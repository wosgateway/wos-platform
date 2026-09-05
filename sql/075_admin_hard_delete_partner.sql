-- ============================================================================
-- 075_admin_hard_delete_partner.sql
--
-- Backing RPC for src/app/api/admin/partners/[id]/hard-delete/route.ts's
-- DELETE handler. Replaces the route's own step-by-step
-- resolve -> ownership-check -> count-check -> delete x4 sequence (each a
-- separate round trip, separate transaction) with one function that does
-- all of it inside a single Postgres transaction, under a row lock taken
-- on the partner FIRST.
--
-- Why this had to move out of TypeScript (per review, both P0s below):
--
--   1. TOCTOU on the business-rule guards. The route checked
--      order_items/packages/reviews = 0, then issued four separate
--      DELETE statements afterward. Between the check and the deletes,
--      another request could INSERT a package for this partner and it
--      would get silently CASCADE-deleted with nothing having re-verified
--      the zero-count invariant. Inside this function, SELECT ... FOR
--      UPDATE on the partner row is taken before any check runs, and
--      Postgres takes a FOR KEY SHARE lock on the referenced row for any
--      concurrent INSERT that has a FK pointing at it — so a concurrent
--      insert into order_items/packages/reviews for this partner_id
--      blocks until this transaction commits or rolls back, and by the
--      time it can proceed, either this whole delete has already
--      committed (partner+everything gone, insert now fails as an FK
--      violation on a row that no longer exists) or it rolled back (in
--      which case the insert proceeds against a partner that was never
--      actually deleted). Either way, there is no window where the
--      counted-as-zero invariant is stale by the time deletion happens.
--
--   2. Ownership trust. The route resolved organizations/branches
--      belonging to a partner and passed those ids down into delete
--      calls. Verified live (2026-09) via the ownership audit queries
--      that no cross-partner entanglement currently exists in
--      production, but the route itself never re-derived the graph at
--      delete time from anything other than what it had just resolved a
--      few lines above — a caller passing a tampered id set had nothing
--      re-checking it server-side beyond that same resolution. This
--      function re-derives organizations/branches from partner_id alone
--      (never accepts them as input) and additionally rejects if any
--      resolved organization or branch is explicitly owned (non-null
--      partner_id) by a DIFFERENT partner — the two ownership-conflict
--      shapes the review flagged:
--        Partner A -> Organization X -> Branch A (partner_id = A)
--                                     -> Branch B (partner_id = B)  <- conflict
--        Organization X (partner_id = B) reachable via Branch A (partner_id = A) <- conflict
--
--   3. User external-reference (P1, round-2 review). packages.submitted_by
--      and reviews.moderated_by both reference users.id with NO explicit
--      ON DELETE (defaults to NO ACTION) — same live-schema-drift pattern
--      as branches.partner_id and reviews.partner_id above, not present
--      in any tracked migration file. order_items/packages/reviews = 0
--      above only guards rows scoped to THIS partner; a package or review
--      belonging to a DIFFERENT partner can still hold a
--      submitted_by/moderated_by pointing at one of THIS partner's users,
--      and that reference blocks "DELETE FROM public.users" regardless of
--      who owns the referencing row. Guarded explicitly against the
--      resolved user set below, separately from the partner-scoped
--      business-rule counts, since those counts cannot see it.
--
--      BEFORE RUNNING THIS MIGRATION, confirm the current data has none
--      of this entanglement (expected: 0 rows):
--        WITH target_users AS (
--          SELECT u.id FROM public.users u
--          WHERE u.organization_id IN (SELECT id FROM public.organizations WHERE partner_id = '<TARGET_PARTNER_UUID>')
--             OR u.branch_id IN (SELECT id FROM public.branches WHERE partner_id = '<TARGET_PARTNER_UUID>')
--        )
--        SELECT u.id AS user_id, u.email, p.id AS package_id, p.partner_id AS package_partner_id,
--               r.id AS review_id, r.partner_id AS review_partner_id
--        FROM target_users u2 JOIN public.users u ON u.id = u2.id
--        LEFT JOIN public.packages p ON p.submitted_by = u.id
--        LEFT JOIN public.reviews r ON r.moderated_by = u.id
--        WHERE p.id IS NOT NULL OR r.id IS NOT NULL;
--      A non-zero result here doesn't block deployment of this migration
--      (the guard below will simply reject that one partner's deletion
--      with 'blocked_user_references' instead of throwing a raw FK
--      violation mid-transaction), but it does mean don't hard-delete
--      that specific partner until it's resolved.
--
-- What stays in TypeScript (route.ts), deliberately:
--   - requireAdmin() / auth entirely — RPC has no session context, is
--     service_role-only (see REVOKE/GRANT below), and trusts the caller
--     completely. It must only ever be invoked from a route that has
--     already checked admin authorization.
--   - Supabase Auth user deletion — no plpgsql access to the Auth Admin
--     API; that's an HTTP call the route makes AFTER this function
--     commits, using the supabaseUserId list this function returns.
--   - audit_log write — route's job, after both DB deletion and Auth
--     cleanup have run, so the log can record the real combined outcome
--     rather than just "DB done."
--   - GET's precheck report — reads only, never mutates, stays as
--     plain TS queries so the frontend gets its confirmation-dialog
--     data without taking any lock.
--
-- Deletion order inside the function (children before parents, same
-- reasoning as the route's old inline comments, now enforced inside one
-- transaction instead of four sequential ones):
--   1. public.users — organization_id is NOT NULL + ON DELETE CASCADE
--      from organizations (001), so this would cascade automatically
--      once organizations are deleted below; deleted explicitly anyway
--      so a user reachable only via branch_id (nullable, ON DELETE SET
--      NULL, never CASCADE) doesn't get missed and left with a
--      dangling branch_id. Preceded by the external-reference guard
--      (point 3 above) — packages.submitted_by / reviews.moderated_by
--      are NO ACTION and would otherwise turn this step into a raw FK
--      violation instead of a clean, named rejection.
--   2. branches — both those with partner_id = p_partner_id (072) and
--      every other branch under a resolved organization_id.
--   3. organizations — those with partner_id = p_partner_id (010) and
--      any organization reachable via a branches.partner_id = p_partner_id
--      row. Does NOT touch packages (packages.organization_id does not
--      exist live — packages hangs off partner_id directly, see below).
--   4. public.partners row itself — deposit_rules/settlements/packages
--      all CASCADE automatically per the live FK graph (verified 2026-09
--      via pg_constraint, confirmed closed — 7 tables reference
--      partners(id) and all 7 are accounted for here); order_items
--      (RESTRICT) and reviews (NO ACTION, no explicit ON DELETE) are
--      both re-checked as zero above under the lock, so this DELETE
--      cannot itself throw an FK violation.
--
-- branches.partner_id -> partners has NO explicit ON DELETE (defaults to
-- NO ACTION, contradicting 072's stated SET NULL intent) — not an active
-- bug only because every branch with partner_id = p_partner_id is
-- deleted in step 2, strictly before the partners DELETE in step 4.
-- organizations.partner_id -> partners IS ON DELETE SET NULL, which is
-- exactly why ownership must be verified BEFORE deleting (an org that
-- slipped resolution would silently survive with partner_id set to
-- NULL rather than raising anything) — this is the failure mode the
-- ownership-conflict checks below exist to catch ahead of time, not
-- after.
-- ============================================================================

-- No DROP FUNCTION first (review, round 2): the signature (UUID) hasn't
-- changed across revisions of this file, so CREATE OR REPLACE alone is
-- sufficient and avoids the brief window where the function doesn't
-- exist at all mid-deploy. Only DROP explicitly if a future revision
-- changes the argument list (Postgres can't CREATE OR REPLACE across a
-- signature change) or return type in an incompatible way.
CREATE OR REPLACE FUNCTION public.admin_hard_delete_partner(p_partner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_partner RECORD;
    v_org_ids UUID[];
    v_branch_ids UUID[];
    v_conflict_orgs UUID[];
    v_conflict_branches UUID[];
    v_conflict_users UUID[];
    v_order_items_count INT;
    v_packages_count INT;
    v_reviews_count INT;
    v_users JSONB;
BEGIN
    -- Lock first, check second, delete third — all three under the same
    -- lock, same transaction. This ordering is what closes the TOCTOU
    -- gap described above.
    SELECT * INTO v_partner FROM public.partners WHERE id = p_partner_id FOR UPDATE;
    IF v_partner IS NULL THEN
        RAISE EXCEPTION 'partner_not_found';
    END IF;

    -- Resolve organizations entangled with this partner, however linked
    -- (organizations.partner_id per 010, or reachable via a branch that
    -- carries partner_id per 072) — mirrors resolveEntanglement()'s old
    -- TS logic, now re-derived here from partner_id alone rather than
    -- trusted from the caller.
    SELECT COALESCE(array_agg(DISTINCT o.id), ARRAY[]::UUID[]) INTO v_org_ids
    FROM public.organizations o
    WHERE o.partner_id = p_partner_id
       OR o.id IN (
            SELECT b.organization_id FROM public.branches b
            WHERE b.partner_id = p_partner_id AND b.organization_id IS NOT NULL
          );

    -- Resolve every branch under this partner: those carrying
    -- partner_id = p_partner_id directly, plus every other branch under
    -- a resolved organization (legacy rows from before 072 may have an
    -- organization link but no partner_id of their own).
    SELECT COALESCE(array_agg(DISTINCT b.id), ARRAY[]::UUID[]) INTO v_branch_ids
    FROM public.branches b
    WHERE b.partner_id = p_partner_id
       OR b.organization_id = ANY(v_org_ids);

    -- Ownership guard #1: an organization pulled in via a branch link
    -- that is itself explicitly owned by a DIFFERENT partner.
    -- e.g. Organization X (partner_id = Partner B) reached only because
    -- Branch A under it has partner_id = Partner A.
    SELECT array_agg(o.id) INTO v_conflict_orgs
    FROM public.organizations o
    WHERE o.id = ANY(v_org_ids)
      AND o.partner_id IS NOT NULL
      AND o.partner_id <> p_partner_id;

    IF v_conflict_orgs IS NOT NULL AND array_length(v_conflict_orgs, 1) > 0 THEN
        RAISE EXCEPTION 'ownership_conflict_organizations: %', v_conflict_orgs;
    END IF;

    -- Ownership guard #2: a branch pulled in via a resolved organization
    -- that is itself explicitly owned by a DIFFERENT partner.
    -- e.g. Organization X (this partner) has Branch B with
    -- partner_id = Partner B.
    SELECT array_agg(b.id) INTO v_conflict_branches
    FROM public.branches b
    WHERE b.id = ANY(v_branch_ids)
      AND b.partner_id IS NOT NULL
      AND b.partner_id <> p_partner_id;

    IF v_conflict_branches IS NOT NULL AND array_length(v_conflict_branches, 1) > 0 THEN
        RAISE EXCEPTION 'ownership_conflict_branches: %', v_conflict_branches;
    END IF;

    -- Business-rule guards — "ล็อคไว้เฉพาะ partner ที่ไม่มี order/package/
    -- review จริง" — now atomic against concurrent inserts thanks to the
    -- FOR UPDATE lock taken above (see file header, point 1).
    SELECT count(*) INTO v_order_items_count FROM public.order_items WHERE partner_id = p_partner_id;
    IF v_order_items_count > 0 THEN
        RAISE EXCEPTION 'blocked_order_items: %', v_order_items_count;
    END IF;

    SELECT count(*) INTO v_packages_count FROM public.packages WHERE partner_id = p_partner_id;
    IF v_packages_count > 0 THEN
        RAISE EXCEPTION 'blocked_packages: %', v_packages_count;
    END IF;

    SELECT count(*) INTO v_reviews_count FROM public.reviews WHERE partner_id = p_partner_id;
    IF v_reviews_count > 0 THEN
        RAISE EXCEPTION 'blocked_reviews: %', v_reviews_count;
    END IF;

    -- User external-reference guard (P1, round-2 review; see file header
    -- point 3). packages.submitted_by / reviews.moderated_by -> users.id
    -- are both NO ACTION and are NOT partner-scoped columns, so the three
    -- counts above cannot see this: a package or review belonging to a
    -- completely different partner can still reference one of THIS
    -- partner's users and block the DELETE FROM public.users below.
    -- Checked against the resolved user set specifically, from ANY
    -- partner's packages/reviews, not just this partner's own.
    SELECT array_agg(DISTINCT u.id) INTO v_conflict_users
    FROM public.users u
    WHERE (u.organization_id = ANY(v_org_ids) OR u.branch_id = ANY(v_branch_ids))
      AND (
            EXISTS (SELECT 1 FROM public.packages p WHERE p.submitted_by = u.id)
            OR EXISTS (SELECT 1 FROM public.reviews r WHERE r.moderated_by = u.id)
          );

    IF v_conflict_users IS NOT NULL AND array_length(v_conflict_users, 1) > 0 THEN
        RAISE EXCEPTION 'blocked_user_references: %', v_conflict_users;
    END IF;

    -- Capture every portal user (+ their Auth UUID) about to be deleted,
    -- for the route to hand to the Auth Admin API afterward. This has to
    -- happen before the DELETE below — it's the only copy of
    -- supabase_user_id that will exist once public.users is gone, which
    -- is exactly the recovery-handle gap the review flagged.
    SELECT COALESCE(
             jsonb_agg(jsonb_build_object(
               'id', u.id,
               'email', u.email,
               'supabaseUserId', u.supabase_user_id
             )),
             '[]'::jsonb
           )
      INTO v_users
    FROM public.users u
    WHERE u.organization_id = ANY(v_org_ids)
       OR u.branch_id = ANY(v_branch_ids);

    -- 1. public.users
    DELETE FROM public.users
    WHERE organization_id = ANY(v_org_ids)
       OR branch_id = ANY(v_branch_ids);

    -- 2. branches
    DELETE FROM public.branches WHERE id = ANY(v_branch_ids);

    -- 3. organizations (does not touch packages — packages hangs off
    -- partner_id directly, not organization_id, in the live schema)
    DELETE FROM public.organizations WHERE id = ANY(v_org_ids);

    -- 4. the partner row — deposit_rules/settlements/packages CASCADE
    -- automatically; order_items/reviews already verified zero above.
    DELETE FROM public.partners WHERE id = p_partner_id;

    RETURN jsonb_build_object(
        'partnerId', p_partner_id,
        'deletedOrganizations', to_jsonb(v_org_ids),
        'deletedBranches', to_jsonb(v_branch_ids),
        'deletedUsers', v_users,
        'partnerSnapshot', jsonb_build_object(
            'name', v_partner.name,
            'category', v_partner.category,
            'status', v_partner.status
        )
    );
END;
$$;

-- service_role only — same pattern as 065's partner_update_own_profile.
-- This function has no caller-supplied scoping (it trusts p_partner_id
-- completely and does its own admin-equivalent destructive work), so it
-- must never be reachable by `authenticated` or `anon`; the route's
-- requireAdmin() check is the only authorization gate in front of it.
REVOKE ALL ON FUNCTION public.admin_hard_delete_partner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_hard_delete_partner(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.admin_hard_delete_partner(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_partner(UUID) TO service_role;

-- ============================================================================
-- VERIFY after running:
--   select proname, prosecdef from pg_proc where proname = 'admin_hard_delete_partner';
--   -- prosecdef should be true (SECURITY DEFINER)
--
--   select grantee, privilege_type from information_schema.routine_privileges
--   where routine_name = 'admin_hard_delete_partner';
--   -- expect exactly one row: service_role / EXECUTE
--
-- Run the "BEFORE RUNNING THIS MIGRATION" query from the file header
-- against the specific partner you intend to test/delete first — the
-- guard below will reject a real conflict cleanly either way, but it's
-- cheaper to know beforehand.
--
-- Sanity test on a real disposable/test partner with zero order_items,
-- packages, and reviews (never against a partner with real data):
--   select public.admin_hard_delete_partner('<test-partner-uuid>');
-- ============================================================================
