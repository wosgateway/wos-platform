-- ============================================================
-- MIGRATION 048: fix partners public SELECT RLS (inactive partners
-- were fully readable via anon key, bypassing status filtering)
--
-- Root cause: 006_legacy_directory_tables.sql created TWO permissive
-- SELECT policies on public.partners:
--
--   "Public can view partners"        USING (true)
--   "public read active partners"     USING (status = 'active')
--
-- Postgres combines multiple PERMISSIVE policies for the same command
-- with OR. Having `USING (true)` present means the second, intended
-- restriction has never actually applied — any row is selectable by
-- anon/authenticated regardless of `status`, including 'inactive'
-- partners and every column added since (045: address,
-- google_maps_url, latitude, longitude, location_status, etc).
--
-- 041_rls_hardening_restrict_to_authenticated.sql explicitly chose to
-- leave both policies in place ("Keep the two public SELECT policies
-- as-is... marketing directory") without noticing they overlap —
-- that comment's premise is corrected by this migration.
--
-- Fix: drop the unconditional policy, keep only the status-scoped one.
-- Purely a privilege reduction — no column/table change, safe to run
-- anytime, nothing depends on inactive partners being anon-readable
-- (fetchPartners() already filtered status='active'; fetchPartnerById()
-- is fixed to match in the same change as this migration, see the
-- application-side commit alongside this file).
-- ============================================================

DROP POLICY IF EXISTS "Public can view partners" ON public.partners;

-- "public read active partners" (status = 'active') already exists
-- from 006 and is untouched here — it becomes the only public SELECT
-- policy on this table after this migration runs.

-- ============================================================
-- QA — run after applying on staging
-- ============================================================

-- Expected: exactly ONE row — "public read active partners" only.
-- If "Public can view partners" still shows up here, the DROP above
-- didn't take (e.g. wrong schema/table) — investigate before moving on.
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partners' AND cmd = 'SELECT';

-- Manual smoke test — run as anon (Supabase SQL editor "Run as" /
-- REST with the anon key), NOT as postgres superuser:
--   1) Pick or create a throwaway partner with status = 'inactive'.
--   2) SELECT * FROM public.partners WHERE id = '<that id>';
--      Expected: 0 rows (previously: 1 row, the bug this fixes).
--   3) SELECT * FROM public.partners WHERE status = 'active' LIMIT 1;
--      Expected: still works normally — active partners unaffected.
