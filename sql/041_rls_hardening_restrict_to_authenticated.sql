-- ============================================================
-- 041_rls_hardening_restrict_to_authenticated.sql
--
-- WHY THIS MIGRATION EXISTS
-- --------------------------------------------------------------
-- A review claimed several policies were left on role `public`
-- (anon + authenticated). Checked against the actual migration
-- files in this repo (not a live DB dump) and the claim is
-- confirmed, but the real scope is bigger than the review found:
--
-- 1. Migration 007 rewrote org-scoped policies for organizations,
--    branches, users, patients, documents, subscriptions,
--    notifications, and packages WITHOUT a `TO authenticated`
--    clause, so every one of them now defaults to `public`.
--    `patients` and `documents` are visible/manageable by an
--    anonymous request as long as the USING clause's subquery
--    happens to match — this is a PHI/PII exposure risk on a
--    medical/wellness booking platform.
--
-- 2. For partner_packages and partner_bookings, migration 007
--    created a SECOND, differently-named policy on the same
--    table/command as migration 004's correctly-scoped
--    `TO authenticated` policy. Postgres OR's multiple permissive
--    policies together, so the new public-role policy from 007
--    silently widens access even though the older authenticated
--    policy is still sitting there looking correct. These
--    duplicates need to be dropped, not "fixed".
--
-- 3. Migration 009's payments fix (`Partners can view payments
--    for their order items`) also has no TO clause -> public.
--    This exposes payment slips, amounts, and order/customer
--    linkage.
--
-- 4. NOT flagged by the review, but worse: `public.partners`
--    (migration 006) has:
--      - "Allow public delete on partners" -> TO anon, authenticated,
--        USING (true)  => literally anyone, logged in or not, can
--        delete any partner directory row.
--      - "Enable insert for anon" -> TO anon, authenticated,
--        WITH CHECK (true) => anyone can insert fake partner rows.
--      - "Authenticated can manage partners" / "Authenticated write
--        partners" -> FOR ALL USING (auth.role() = 'authenticated')
--        with NO organization/admin scoping at all, so any logged-in
--        user of the app (any partner org, any role) can edit or
--        delete every partner in the directory, not just their own.
--    Migration 030's own comments already establish the intended
--    pattern for platform-level directory tables: SELECT is public,
--    everything else is `is_platform_admin()` only. This migration
--    applies that same pattern to `partners`.
--
-- SAFE TO RE-RUN: uses DROP POLICY IF EXISTS before every CREATE.
-- Run this AFTER confirming `is_platform_admin()` and
-- `current_user_organization_id()` exist (they're defined in
-- 006/007 respectively).
-- ============================================================


-- ------------------------------------------------------------
-- 1. organizations
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization" ON public.organizations
    FOR SELECT TO authenticated
    USING (id = public.current_user_organization_id());

DROP POLICY IF EXISTS "Users can update their own organization" ON public.organizations;
CREATE POLICY "Users can update their own organization" ON public.organizations
    FOR UPDATE TO authenticated
    USING (id = public.current_user_organization_id())
    WITH CHECK (id = public.current_user_organization_id());

-- ------------------------------------------------------------
-- 2. branches
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their organization's branches" ON public.branches;
CREATE POLICY "Users can view their organization's branches" ON public.branches
    FOR SELECT TO authenticated
    USING (organization_id = public.current_user_organization_id());

-- ------------------------------------------------------------
-- 3. users
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their organization's users" ON public.users;
CREATE POLICY "Users can view their organization's users" ON public.users
    FOR SELECT TO authenticated
    USING (organization_id = public.current_user_organization_id());

-- ------------------------------------------------------------
-- 4. patients  (PHI — highest priority in this file)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their organization's patients" ON public.patients;
CREATE POLICY "Users can view their organization's patients" ON public.patients
    FOR SELECT TO authenticated
    USING (organization_id = public.current_user_organization_id());

-- ------------------------------------------------------------
-- 5. documents
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their organization's documents" ON public.documents;
CREATE POLICY "Users can view their organization's documents" ON public.documents
    FOR SELECT TO authenticated
    USING (organization_id = public.current_user_organization_id());

DROP POLICY IF EXISTS "Users can manage their organization's documents" ON public.documents;
CREATE POLICY "Users can manage their organization's documents" ON public.documents
    FOR ALL TO authenticated
    USING (organization_id = public.current_user_organization_id())
    WITH CHECK (organization_id = public.current_user_organization_id());

-- ------------------------------------------------------------
-- 6. subscriptions
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their organization's subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view their organization's subscriptions" ON public.subscriptions
    FOR SELECT TO authenticated
    USING (organization_id = public.current_user_organization_id());

DROP POLICY IF EXISTS "Users can manage their organization's subscriptions" ON public.subscriptions;
CREATE POLICY "Users can manage their organization's subscriptions" ON public.subscriptions
    FOR ALL TO authenticated
    USING (organization_id = public.current_user_organization_id())
    WITH CHECK (organization_id = public.current_user_organization_id());

-- ------------------------------------------------------------
-- 7. notifications
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their organization's notifications" ON public.notifications;
CREATE POLICY "Users can view their organization's notifications" ON public.notifications
    FOR SELECT TO authenticated
    USING (organization_id = public.current_user_organization_id());

DROP POLICY IF EXISTS "Users can update their organization's notifications" ON public.notifications;
CREATE POLICY "Users can update their organization's notifications" ON public.notifications
    FOR UPDATE TO authenticated
    USING (organization_id = public.current_user_organization_id());

-- ------------------------------------------------------------
-- 8. packages (partner-owned catalog rows, not the public listing)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Partners can manage their own packages" ON public.packages;
CREATE POLICY "Partners can manage their own packages" ON public.packages
    FOR ALL TO authenticated
    USING (
        partner_id IN (
            SELECT b.partner_id
            FROM public.users u
            JOIN public.branches b ON b.id = u.branch_id
            WHERE u.supabase_user_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        partner_id IN (
            SELECT b.partner_id
            FROM public.users u
            JOIN public.branches b ON b.id = u.branch_id
            WHERE u.supabase_user_id = (SELECT auth.uid())
        )
    );

-- NOTE: this table also carries the org-scoped "Users can view/manage
-- their organization's packages" policies from 001/007 on the SAME
-- table name `packages` (different table than partner_packages). If
-- those are still present and unused by the app, confirm with the
-- team whether to drop them outright rather than re-scope — leaving
-- two different ownership models (partner_id vs organization_id) on
-- one table is itself worth resolving, separately from this patch.

-- ------------------------------------------------------------
-- 9. payments
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Partners can view payments for their order items" ON public.payments;
CREATE POLICY "Partners can view payments for their order items" ON public.payments
    FOR SELECT TO authenticated
    USING (
        (
            order_item_id IS NOT NULL
            AND order_item_id IN (
                SELECT id FROM public.order_items
                WHERE partner_id = public.current_user_partner_id()
            )
        )
        OR
        (
            order_item_id IS NULL
            AND order_id IN (
                SELECT order_id FROM public.order_items
                WHERE partner_id = public.current_user_partner_id()
            )
        )
    );
-- CORRECTED (was previously wrong in this file): migration 010 renamed
-- order_items.organization_id -> partner_id and repointed this policy
-- at organizations-via-JWT translation, which depends on a JWT claim
-- (auth.jwt() -> 'user_metadata' ->> 'organization_id') that migration
-- 039 confirms the app never sets. Using current_user_partner_id()
-- here instead — same helper the packages policy above uses — avoids
-- both the wrong column name and the dead JWT path. See
-- 042_fix_partner_scoping_dead_jwt_claim.sql for the same fix applied
-- to order_items and settlements, which have the identical issue.

-- ------------------------------------------------------------
-- 10. partner_packages — drop migration 007's duplicate PUBLIC policies;
--     migration 004's `TO authenticated` policies of the same shape
--     already cover this table correctly and are left untouched.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their organization's packages" ON public.partner_packages;
DROP POLICY IF EXISTS "Users can manage their organization's packages" ON public.partner_packages;

-- ------------------------------------------------------------
-- 11. partner_bookings — same situation as partner_packages.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their organization's bookings" ON public.partner_bookings;
DROP POLICY IF EXISTS "Users can manage their organization's bookings" ON public.partner_bookings;

-- ------------------------------------------------------------
-- 12. partners (public directory table — no organization_id, admin-only writes)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public delete on partners" ON public.partners;
DROP POLICY IF EXISTS "Enable insert for anon" ON public.partners;
DROP POLICY IF EXISTS "Authenticated can manage partners" ON public.partners;
DROP POLICY IF EXISTS "Authenticated write partners" ON public.partners;

-- Keep the two public SELECT policies as-is (marketing directory,
-- meant to be readable by anon) — "Public can view partners" and
-- "public read active partners" are untouched by this migration.

CREATE POLICY "Platform admins can manage partners" ON public.partners
    FOR ALL TO authenticated
    USING (public.is_platform_admin())
    WITH CHECK (public.is_platform_admin());

-- ============================================================
-- VERIFY after running:
--
--   SELECT tablename, policyname, cmd, roles
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND roles @> ARRAY['public']::name[]
--   ORDER BY tablename, cmd;
--
-- Expected rows remaining on `public` role after this migration:
--   packages          / "Public can view packages"        (marketing)
--   partners          / "Public can view partners"         (marketing)
--   partners          / "public read active partners"      (marketing)
--   deposit_rules     / "Anyone can view active deposit rules"
--   cases             / any INSERT-only public policy you intend to keep
--   partner_applications / "Allow public insert on partner_applications"
-- Anything else showing `public` after this runs needs a follow-up.
--
-- Then manually re-test as a logged-out (anon) request:
--   - GET a payments row directly via the REST API -> should now 401/403.
--   - PATCH/DELETE a partners row directly via the REST API -> should now 401/403.
--   - SELECT patients/documents/subscriptions directly -> should now 401/403.
-- And re-test as an authenticated partner user from a DIFFERENT org:
--   - confirm you still cannot see another org's patients/bookings/payments.
-- ============================================================
