-- ============================================================
-- QA script for migration 048 — run AFTER 048 is applied.
-- Run each block as-is in the Supabase SQL editor with
-- "Run as: anon" selected (top-right role switcher), NOT as
-- postgres/service_role — RLS is bypassed for superuser, so testing
-- as postgres would show a false pass.
-- ============================================================

-- ------------------------------------------------------------
-- (a) Baseline — an active, verified partner should still read fine.
-- Uses Bangkok Hospital Udon (the one partner already verified as of
-- this writing). Swap the id if that changes.
-- Expected: 1 row.
-- ------------------------------------------------------------
SELECT id, name, status, location_status
FROM public.partners
WHERE id = '34a120aa-266c-4550-a2b0-6141ea22813d';

-- ------------------------------------------------------------
-- (b) The actual regression test — flip it to inactive, confirm it
-- disappears from anon reads, then always flip it back in the same
-- session before doing anything else. Run these three statements as
-- postgres/service_role (RLS doesn't apply to the UPDATE itself,
-- and switching "Run as" mid-script isn't reliable in the SQL editor
-- UI) — only the SELECT in between needs to run as anon.
-- ------------------------------------------------------------

-- as postgres/service_role:
UPDATE public.partners SET status = 'inactive'
WHERE id = '34a120aa-266c-4550-a2b0-6141ea22813d';

-- switch "Run as" to anon, then run:
-- Expected: 0 rows. If this still returns 1 row, migration 048 did
-- not take — stop and re-check `DROP POLICY` ran against the right
-- schema before touching anything else.
SELECT id, name, status
FROM public.partners
WHERE id = '34a120aa-266c-4550-a2b0-6141ea22813d';

-- switch "Run as" back to postgres/service_role, then immediately
-- roll back — do not leave this partner inactive:
UPDATE public.partners SET status = 'active'
WHERE id = '34a120aa-266c-4550-a2b0-6141ea22813d';

-- ------------------------------------------------------------
-- (c) Confirm the app-level filter added to fetchPartnerById() lines
-- up with the RLS fix — this isn't a SQL test, it's a manual step:
-- while the partner is (briefly) inactive in step (b), open
-- /th/partners/34a120aa-266c-4550-a2b0-6141ea22813d in a browser.
-- Expected: 404 (not-found page), not the partner detail page.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- (d) Final policy check — exactly one SELECT policy should remain.
-- Safe to run as postgres.
-- ------------------------------------------------------------
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partners' AND cmd = 'SELECT';
-- Expected: exactly 1 row — "public read active partners", qual =
-- (status = 'active'::text)
