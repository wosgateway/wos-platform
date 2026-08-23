-- ============================================================
-- 043_rls_cleanup_dashboard_policies.sql
--
-- SCOPE: role-grant hygiene only. Does NOT change USING/WITH CHECK
-- logic on any policy — deliberately, because this file targets
-- policies that were never in any tracked migration (created
-- directly via the Supabase Dashboard at some point), so their exact
-- current qual/with_check is not something this repo can confirm.
-- Guessing at that logic and using DROP+CREATE is exactly the
-- mistake that broke the `payments` policy earlier in this project
-- (041's first draft). ALTER POLICY ... TO <role> changes only the
-- role list and leaves the existing expression untouched, so it's
-- safe even without seeing the current qual.
--
-- `public.bookings` INSERT ("Public can create a booking") is left
-- untouched entirely and deliberately — confirmed still receiving
-- writes as of Aug 2026, not a dead legacy table. Revisit once the
-- app fully moves onto orders/order_items and this table stops
-- taking direct writes.
--
-- Each ALTER runs inside its own DO block with exception handling:
-- if a policy name doesn't exist on your DB (e.g. it's actually
-- named slightly differently, or was already fixed), that one
-- statement reports a NOTICE and the rest of the migration still
-- runs, instead of the whole script aborting like last time.
-- ============================================================

DO $$
BEGIN
    ALTER POLICY "Authenticated can view bookings" ON public.bookings TO authenticated;
EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'Skipped: policy "Authenticated can view bookings" on public.bookings not found — check exact name in pg_policies.';
END $$;

DO $$
BEGIN
    ALTER POLICY "Authenticated can update bookings" ON public.bookings TO authenticated;
EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'Skipped: policy "Authenticated can update bookings" on public.bookings not found.';
END $$;

DO $$
BEGIN
    ALTER POLICY "Authenticated can delete bookings" ON public.bookings TO authenticated;
EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'Skipped: policy "Authenticated can delete bookings" on public.bookings not found.';
END $$;

DO $$
BEGIN
    ALTER POLICY "Platform admins can manage all bookings" ON public.bookings TO authenticated;
EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'Skipped: policy "Platform admins can manage all bookings" on public.bookings not found.';
END $$;

-- "Public can create a booking" — intentionally NOT altered.
-- Keep public INSERT: bookings still receives active writes as of
-- Aug 2026 (confirmed via recent created_at timestamps). Revisit
-- after full migration to orders/order_items.

-- ------------------------------------------------------------
-- partners: drop the untracked duplicate admin policy, keep the
-- one 041 created (same intent, already TO authenticated).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Platform admins can manage all partners" ON public.partners;
-- "Platform admins can manage partners" (created in 041) remains
-- and already covers this — TO authenticated, USING/WITH CHECK
-- is_platform_admin().

DO $$
BEGIN
    ALTER POLICY "Partners can update own profile" ON public.partners TO authenticated;
EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'Skipped: policy "Partners can update own profile" on public.partners not found.';
END $$;

-- ============================================================
-- VERIFY after running:
--
--   SELECT tablename, policyname, roles, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename IN ('bookings', 'partners')
--   ORDER BY tablename, cmd;
--
-- Expected:
--   - Every bookings/partners policy now shows roles = {authenticated},
--     EXCEPT "Public can create a booking" (still {public}, on
--     purpose) and the two public SELECT partners policies.
--   - `qual` and `with_check` on every row should read EXACTLY the
--     same as before this migration ran — if anything in those
--     columns looks different from what you saw pre-043, stop and
--     flag it, since that would mean something other than the role
--     list changed, which this migration isn't supposed to do.
--
-- If any DO block above logged a NOTICE "Skipped: ... not found",
-- paste the exact policyname/roles/cmd from a fresh pg_policies
-- query for that table so the ALTER can be re-targeted correctly —
-- don't guess a replacement qual for it.
-- ============================================================
