-- ============================================================
-- 042_fix_partner_scoping_dead_jwt_claim.sql
--
-- CONTEXT — why this migration exists, and why it supersedes both
-- the review's suggested payments fix AND migration 041's payments
-- section as originally written:
--
-- 041 copied the payments policy body verbatim from migration 009.
-- The review then suggested rewriting it to join through
-- `order_items.partner_id = current_user_partner_id()`. Both were
-- wrong, for the same reason: neither checked migration 010, which
-- runs AFTER 009 and does two things that change the ground truth:
--
--   1. Renames order_items.organization_id -> partner_id (now FKs to
--      `partners`, not `organizations`), and does the same rename on
--      deposit_rules.organization_id and settlements.organization_id.
--
--   2. Uses ALTER POLICY (not DROP+CREATE) to repoint the payments,
--      order_items (SELECT + UPDATE), and settlements policies at
--      the renamed column. ALTER POLICY only rewrites USING/WITH
--      CHECK — it does NOT touch the policy's role list. So today,
--      after 010, all four of these policies still carry no `TO`
--      clause (role = public, same bug 041 fixes elsewhere) AND
--      their USING clause is:
--
--        partner_id = (
--            SELECT partner_id FROM public.organizations
--            WHERE id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
--        )
--
-- That JWT claim is the same one migration 039's own header comment
-- confirms is NEVER SET by this app (039 fixed the exact same dead
-- claim on organizations.UPDATE). Practically: `auth.jwt() ->
-- 'user_metadata' ->> 'organization_id'` evaluates to NULL for every
-- real request, so the subquery returns NULL, and `partner_id =
-- NULL` is never true. Net effect today:
--
--   - No active data leak via Supabase's auto REST API — the broken
--     clause fails CLOSED (returns zero rows), not open.
--   - But the policies are dead: no anon OR authenticated request
--     using the normal Supabase client keys can ever see a row
--     through them, regardless of who they are.
--   - The partner portal isn't currently affected because
--     src/lib/partner/orders.ts uses the service-role client
--     (bypasses RLS entirely) and does its own authorization in
--     application code. That's the reason this hasn't shown up as a
--     visible bug — but it also means these RLS policies are not
--     actually providing the defense-in-depth they look like they
--     provide, on top of already being scoped to `public`.
--
-- FIX: point all four at current_user_partner_id() — the helper
-- migration 007 already built (users -> branches -> partner_id) —
-- instead of the dead organizations-JWT translation, and add
-- `TO authenticated`. This is the same helper the packages policy
-- (fixed in 041) already uses, so ownership resolution is now
-- consistent across packages/order_items/payments/settlements.
--
-- Run this AFTER 041. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. order_items
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Partners can view their organization's order items" ON public.order_items;
CREATE POLICY "Partners can view their organization's order items" ON public.order_items
    FOR SELECT TO authenticated
    USING (partner_id = public.current_user_partner_id());

DROP POLICY IF EXISTS "Partners can update their organization's order items" ON public.order_items;
CREATE POLICY "Partners can update their organization's order items" ON public.order_items
    FOR UPDATE TO authenticated
    USING (partner_id = public.current_user_partner_id())
    WITH CHECK (partner_id = public.current_user_partner_id());
-- NOTE: the original (005/008) had no WITH CHECK on the UPDATE
-- policy at all — adding one here so a partner can't UPDATE a row
-- they can see into having a DIFFERENT partner_id. If some existing
-- app flow relies on being able to move an order_item to another
-- partner via this policy (unlikely, but check admin-assign routes
-- since those should go through the service-role client anyway),
-- confirm before running.

-- ------------------------------------------------------------
-- 2. settlements
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Partners can view their organization's settlements" ON public.settlements;
CREATE POLICY "Partners can view their organization's settlements" ON public.settlements
    FOR SELECT TO authenticated
    USING (partner_id = public.current_user_partner_id());

-- ------------------------------------------------------------
-- 3. payments
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

-- ============================================================
-- VERIFY after running:
--
--   SELECT tablename, policyname, roles, cmd, qual
--   FROM pg_policies
--   WHERE tablename IN ('order_items', 'settlements', 'payments')
--   ORDER BY tablename, cmd;
--
-- Expected: roles = {authenticated} on all rows, and `qual` should
-- reference current_user_partner_id(), not auth.jwt().
--
-- Then re-test the direct REST API (not just the app UI, since the
-- app UI goes through the service-role client and won't exercise
-- these policies at all):
--   - As an authenticated partner-portal user, GET /rest/v1/order_items
--     with the anon key + user's access token -> should now return
--     that partner's own rows (previously returned zero, silently).
--   - As a DIFFERENT partner's authenticated user, confirm you still
--     get zero rows for the first partner's data.
-- ============================================================
