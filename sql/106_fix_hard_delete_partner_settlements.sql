-- ============================================================================
-- 106_fix_hard_delete_partner_settlements.sql
--
-- Patches public.admin_hard_delete_partner (075) after 105 changed the
-- settlements FK from CASCADE to RESTRICT. CREATE OR REPLACE, same
-- signature as 075 — no DROP FUNCTION needed (same reasoning as 075's
-- own header: avoids a window where the function doesn't exist mid-deploy).
--
-- WHY THIS IS NEEDED (regression introduced between 075 and 105, not a
-- new requirement):
--
--   075's header comment claimed "deposit_rules/settlements/packages all
--   CASCADE automatically" and cited a live pg_constraint check from
--   2026-09 as proof. That was true AT THE TIME — 010 set
--   settlements.partner_id -> partners(id) ON DELETE CASCADE. But 105
--   DROPPED the old settlements/settlement_items tables entirely (DROP
--   TABLE ... CASCADE) and recreated settlements from scratch with a
--   DIFFERENT constraint:
--
--     -- 105_settlement_engine.sql
--     partner_id UUID NOT NULL
--         REFERENCES public.partners(id)
--         ON DELETE RESTRICT,
--
--   075's function was never updated to match. It still has no explicit
--   check for settlements, and still ends with a bare
--   "DELETE FROM public.partners WHERE id = p_partner_id" expecting
--   settlements to disappear quietly with it. Since 105, that DELETE
--   instead throws a raw, unnamed Postgres FK-violation
--   (SQLSTATE 23503) if the partner has ANY settlement row — inside the
--   same transaction as the already-committed-in-memory users/branches/
--   organizations deletes (which then roll back too, so no partial-delete
--   risk — but the error surfacing is broken):
--
--     - route.ts's DELETE handler pattern-matches rpcErr.message against
--       'partner_not_found' / 'ownership_conflict' / 'blocked_order_items'
--       / 'blocked_packages' / 'blocked_reviews' / 'blocked_user_references'.
--       None of those match a raw FK violation, so it falls through to the
--       generic 500 branch ("ลบไม่สำเร็จ: " + message) instead of the
--       clean 409 the other blockers get.
--     - route.ts's GET precheck already SELECTs settlementsCount and
--       returns it in willDelete.settlements, but never folds it into
--       canDelete or blockingReasons — so the admin's confirmation dialog
--       says deletion is allowed when it is not.
--
--   Settlement rows are financial records (money the partner owes WOS);
--   RESTRICT is the correct FK choice per 105 and must NOT be loosened
--   back to CASCADE. The fix is to make hard-delete SEE that guard
--   explicitly and reject with a named, clean error — the same shape as
--   the existing blocked_order_items/blocked_packages/blocked_reviews
--   checks — instead of letting Postgres's own RESTRICT throw an
--   unhandled violation mid-transaction.
--
-- What changes here: one new check, inserted in the same lock scope as
-- the existing business-rule guards (after the FOR UPDATE lock, before
-- any DELETE runs) — order_items / packages / reviews / settlements are
-- now checked together, in the same section, same lock. Nothing else in
-- 075's function changes.
-- ============================================================================

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
    v_settlements_count INT;
    v_users JSONB;
BEGIN
    -- Lock first, check second, delete third (unchanged from 075).
    SELECT * INTO v_partner FROM public.partners WHERE id = p_partner_id FOR UPDATE;
    IF v_partner IS NULL THEN
        RAISE EXCEPTION 'partner_not_found';
    END IF;

    -- Resolve organizations (unchanged from 075).
    SELECT COALESCE(array_agg(DISTINCT o.id), ARRAY[]::UUID[]) INTO v_org_ids
    FROM public.organizations o
    WHERE o.partner_id = p_partner_id
       OR o.id IN (
            SELECT b.organization_id FROM public.branches b
            WHERE b.partner_id = p_partner_id AND b.organization_id IS NOT NULL
          );

    -- Resolve branches (unchanged from 075).
    SELECT COALESCE(array_agg(DISTINCT b.id), ARRAY[]::UUID[]) INTO v_branch_ids
    FROM public.branches b
    WHERE b.partner_id = p_partner_id
       OR b.organization_id = ANY(v_org_ids);

    -- Ownership guard #1 (unchanged from 075).
    SELECT array_agg(o.id) INTO v_conflict_orgs
    FROM public.organizations o
    WHERE o.id = ANY(v_org_ids)
      AND o.partner_id IS NOT NULL
      AND o.partner_id <> p_partner_id;

    IF v_conflict_orgs IS NOT NULL AND array_length(v_conflict_orgs, 1) > 0 THEN
        RAISE EXCEPTION 'ownership_conflict_organizations: %', v_conflict_orgs;
    END IF;

    -- Ownership guard #2 (unchanged from 075).
    SELECT array_agg(b.id) INTO v_conflict_branches
    FROM public.branches b
    WHERE b.id = ANY(v_branch_ids)
      AND b.partner_id IS NOT NULL
      AND b.partner_id <> p_partner_id;

    IF v_conflict_branches IS NOT NULL AND array_length(v_conflict_branches, 1) > 0 THEN
        RAISE EXCEPTION 'ownership_conflict_branches: %', v_conflict_branches;
    END IF;

    -- Business-rule guards (unchanged from 075, order_items/packages/reviews).
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

    -- ========================================================================
    -- NEW (106): settlements guard.
    --
    -- settlements.partner_id -> partners(id) is ON DELETE RESTRICT as of
    -- 105 (was CASCADE under 010, which is what 075 was written against).
    -- Checked under the same FOR UPDATE lock taken above, so this is
    -- TOCTOU-safe the same way the order_items/packages/reviews checks
    -- are: a concurrent settlement calculation for this partner blocks on
    -- the lock until this transaction resolves, same as a concurrent
    -- order_item insert would.
    --
    -- Deliberately a hard block, not a cascade and not a soft warning —
    -- a settlement is a record of money owed, at any status
    -- (CALCULATED/APPROVED/PAID/LOCKED). Even a PAID or LOCKED settlement
    -- must not disappear when the partner row does; it's the audit trail
    -- for a completed financial obligation.
    -- ========================================================================
    SELECT count(*) INTO v_settlements_count FROM public.settlements WHERE partner_id = p_partner_id;
    IF v_settlements_count > 0 THEN
        RAISE EXCEPTION 'blocked_settlements: %', v_settlements_count;
    END IF;

    -- User external-reference guard (unchanged from 075).
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

    -- Capture portal users for Auth cleanup (unchanged from 075).
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

    -- 3. organizations
    DELETE FROM public.organizations WHERE id = ANY(v_org_ids);

    -- 4. the partner row — deposit_rules CASCADEs (still true, unaffected
    -- by 105); settlements/order_items/reviews already verified zero
    -- above under the lock, so this DELETE cannot itself throw an FK
    -- violation.
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

-- Grants are unchanged from 075 (same function identity), but restated
-- here so this migration is a complete, independently-verifiable unit.
REVOKE ALL ON FUNCTION public.admin_hard_delete_partner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_hard_delete_partner(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.admin_hard_delete_partner(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_partner(UUID) TO service_role;

-- ============================================================================
-- VERIFY after running:
--   select proname, prosecdef from pg_proc where proname = 'admin_hard_delete_partner';
--   -- prosecdef should be true (unchanged)
--
--   select grantee, privilege_type from information_schema.routine_privileges
--   where routine_name = 'admin_hard_delete_partner';
--   -- expect exactly one row: service_role / EXECUTE (unchanged)
--
-- Regression test — pick a partner with at least one settlements row
-- (any status) and confirm it now fails CLEANLY instead of with a raw
-- FK violation:
--   select public.admin_hard_delete_partner('<partner-with-settlement-uuid>');
--   -- expect: ERROR: blocked_settlements: <n>
--   -- (NOT: ERROR: update or delete on table "partners" violates
--   --  foreign key constraint ... on table "settlements")
--
-- Sanity test — a disposable/test partner with zero order_items,
-- packages, reviews, AND settlements still deletes cleanly as before:
--   select public.admin_hard_delete_partner('<test-partner-uuid>');
-- ============================================================================
