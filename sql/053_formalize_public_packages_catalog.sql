-- ============================================================
-- 053_formalize_public_packages_catalog.sql
--
-- CONTEXT: "Public can view packages" on public.packages has never
-- been created by any migration in this repo — it's a dashboard
-- policy, same situation as `reviews` and the pre-043 bookings
-- policies. Unlike those, its EXISTENCE is confirmed intentional:
-- 041_rls_hardening_restrict_to_authenticated.sql's own VERIFY
-- checklist explicitly lists it as an expected row to remain public,
-- annotated "(marketing)". This is the public browse/catalog feature
-- — customers aren't scoped to an organization, so packages must be
-- readable without auth. Not a bug to close, a policy to formalize.
--
-- What IS wrong: the live qual is `USING (true)` — no filter at all.
-- Every other package lookup in this codebase (12, 14, 16, 17, 18,
-- 25, 28, 32, 36, 38) enforces `status = 'published'`, and 38
-- specifically closed a gap where `is_active = false` packages were
-- still reachable despite being published. The table-level SELECT
-- policy never enforced either condition, so draft/unpublished/
-- inactive packages are currently exposed to anon via the REST API
-- directly, bypassing every one of those RPC-level checks. This
-- migration brings the policy in line with the pattern already
-- established everywhere else in the app.
--
-- Also folds in the 🟡 item from the same audit: "Platform admins
-- can manage all packages" currently grants to role {public} instead
-- of {authenticated}. The USING clause (is_platform_admin()) was
-- already safe — is_platform_admin() returns false for anon — so
-- this was never exploitable, just inconsistent with the role-grant
-- pattern the rest of the repo uses (see 041, 043). ALTER POLICY
-- only touches the role list, same safe approach 043 used.
--
-- Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Public catalog SELECT — formalize + scope to published/active
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view packages" ON public.packages;
CREATE POLICY "Public can view packages" ON public.packages
    FOR SELECT TO public
    USING (status = 'published' AND is_active = true);

-- Authenticated org/partner members still see their own packages
-- regardless of status via "Users can view their organization's
-- packages" (001/007) and "Partners can manage their own packages"
-- (041) — both untouched by this migration. Draft packages remain
-- visible to their owning org for editing; this policy only governs
-- what anonymous/public catalog browsing can see.

-- ------------------------------------------------------------
-- 2. Platform admin management — role-grant hygiene only
-- ------------------------------------------------------------
DO $$
BEGIN
    ALTER POLICY "Platform admins can manage all packages" ON public.packages TO authenticated;
EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'Skipped: policy "Platform admins can manage all packages" on public.packages not found — check exact name in pg_policies.';
END $$;

-- ============================================================
-- VERIFY after running:
--
--   SELECT policyname, roles, cmd, qual
--   FROM pg_policies
--   WHERE tablename = 'packages'
--   ORDER BY cmd, policyname;
--
-- Expected:
--   - "Public can view packages": roles = {public}, qual now reads
--     (status = 'published'::text AND is_active = true)
--   - "Platform admins can manage all packages": roles =
--     {authenticated}, qual unchanged (is_platform_admin())
--   - Org-scoped and partner-scoped policies from 001/007/041
--     unchanged.
--
-- Then re-test as anon (no auth header, just the anon key):
--   - GET /rest/v1/packages?select=* -> should now return ONLY rows
--     where status=published AND is_active=true. Any draft or
--     is_active=false row you could see before should now 0-row out.
--   - Confirm the actual public browse page (wherever it queries
--     packages from) still renders correctly — it should, since it
--     was presumably already filtering client-side/server-side on
--     the same columns; this migration just stops the RLS layer from
--     being wider than the app logic already assumed.
-- ============================================================
