-- ============================================================
-- MIGRATION 050: fix partners public SELECT RLS drift (dashboard-edited
-- policy silently added location_status='verified' to the directory,
-- hiding every non-verified active partner from public listings)
--
-- Root cause: at some point after 048 was applied, someone edited the
-- live policy directly on the Supabase dashboard — NOT through a
-- migration file. The policy that should read:
--
--   "public read active partners"   USING (status = 'active')
--
-- currently reads on the live DB as:
--
--   "public read verified active partners"
--     USING (status = 'active' AND location_status = 'verified')
--
-- This condition was never written as a table-level RLS policy in any
-- migration in this repo. `location_status = 'verified'` only ever
-- appears in 047_nearby_partner_functions.sql, scoped deliberately to
-- the nearby_partners / nearby_transit_points RPC functions (both
-- SECURITY INVOKER by design — see 047's own comments) so that the
-- verified-location requirement applies ONLY to the nearby-map
-- feature, not to the general partner directory.
--
-- Effect of the drift: every partner with status='active' but
-- location_status != 'verified' (the default is 'pending' — see 045)
-- silently disappeared from the public directory, with no application
-- code change and no migration to explain why.
--
-- Fix: drop the drifted policy, recreate the policy 006/048 actually
-- intended — scoped to status only. Purely a privilege restoration
-- (widens back to the documented behavior), no column/table change.
-- Safe to run anytime.
-- ============================================================

-- Drop whatever the live policy currently is, under either name, so
-- this migration is idempotent regardless of which state the DB is in.
DROP POLICY IF EXISTS "public read verified active partners" ON public.partners;
DROP POLICY IF EXISTS "public read active partners" ON public.partners;

CREATE POLICY "public read active partners" ON public.partners
    FOR SELECT USING (status = 'active');

-- location_status is intentionally NOT referenced here. It remains
-- enforced only inside nearby_partners() / nearby_transit_points()
-- (047), which is where the "verified" requirement is meant to live.

-- ============================================================
-- QA — run after applying, as anon (Supabase SQL editor "Run as: anon"),
-- NOT as postgres/service_role.
-- ============================================================

-- (a) Exactly one SELECT policy on partners, with the status-only qual.
-- Safe to run as postgres.
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partners' AND cmd = 'SELECT';
-- Expected: exactly 1 row — "public read active partners",
-- qual = (status = 'active'::text)  -- no mention of location_status.

-- (b) An active-but-unverified partner should now be publicly readable.
-- Pick or create a throwaway partner with status='active' AND
-- location_status IN ('pending','rejected'), then as anon:
--   SELECT id, name, status, location_status FROM public.partners
--   WHERE id = '<that id>';
-- Expected: 1 row (previously: 0 rows, the bug this fixes).

-- (c) An inactive partner must still be excluded (048's guarantee
-- must still hold after this change). As anon:
--   SELECT id FROM public.partners WHERE status = 'inactive' LIMIT 1;
-- Expected: 0 rows.

-- (d) nearby_partners()/nearby_transit_points() must still exclude
-- unverified locations — this migration must NOT change that. As anon,
-- call nearby_partners() with a verified partner id from step (b)'s
-- sibling data (or the existing 047 QA fixture) and confirm partners
-- with location_status != 'verified' still don't appear in results.
