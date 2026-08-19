-- ============================================================
-- 008_restrict_cases_rls.sql
-- Tighten RLS on public.cases
--
-- BEFORE this migration, pg_policies showed:
--   "Allow public select on cases"  (anon, authenticated) SELECT  USING (true)
--   "Allow public update on cases"  (anon, authenticated) UPDATE  USING (true)
--   "Allow public insert on cases"  (anon, authenticated) INSERT  WITH CHECK (true)
--   "Enable public insert"          (anon)                INSERT  WITH CHECK (true)
--
-- Problem: SELECT/UPDATE with USING (true) for the `anon` role means
-- anyone holding the public anon key (i.e. anyone who opens the site's
-- network tab) can read AND modify every row in `cases` directly via
-- the Supabase client €” including customer name, phone, LINE ID for
-- every booking/B2B lead ever submitted. No part of the public site
-- reads or updates `cases` (public forms only ever INSERT), so SELECT
-- and UPDATE never needed to be open to anon in the first place.
--
-- This migration:
--   1. Drops the anon-inclusive SELECT/UPDATE policies.
--   2. Recreates SELECT/UPDATE restricted to `authenticated` only
--      (i.e. someone logged into /admin via Supabase Auth).
--   3. Leaves INSERT untouched €” public forms (BecomePartnerForm.tsx,
--      the booking form) submit as anon and must keep working.
--   4. Cleans up the duplicate "Enable public insert" policy, which
--      was redundant with "Allow public insert on cases".
--
-- Safe to run: does not change any existing row, only who can
-- SELECT/UPDATE. Verify PartnerLeadsManager.tsx and admin
-- BookingsManager.tsx (if it also reads `cases`) still load correctly
-- after this runs, since both now require an authenticated session.
-- ============================================================

-- 1. Drop the overly-permissive policies
DROP POLICY IF EXISTS "Allow public select on cases" ON public.cases;
DROP POLICY IF EXISTS "Allow public update on cases" ON public.cases;

-- 2. Recreate SELECT/UPDATE for authenticated (admin) only
CREATE POLICY "Authenticated can select cases" ON public.cases
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated can update cases" ON public.cases
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 3. Clean up duplicate insert policy (keep "Allow public insert on cases",
--    which already covers anon + authenticated with the same condition)
DROP POLICY IF EXISTS "Enable public insert" ON public.cases;

-- ============================================================
-- VERIFY after running (expected result: SELECT/UPDATE only under
-- authenticated, INSERT only under anon+authenticated):
--
--   select policyname, roles, cmd from pg_policies where tablename = 'cases';
-- ============================================================
