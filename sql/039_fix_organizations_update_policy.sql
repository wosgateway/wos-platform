-- ============================================================
-- 039_fix_organizations_update_policy.sql
--
-- BUG FOUND during migration-numbering audit (002 vs 002, 008 vs 008):
--
-- 002_missing_rls_policies.sql added an UPDATE policy on
-- public.organizations gated on:
--   auth.jwt() -> 'user_metadata' ->> 'organization_id'
--
-- Migration 007's own header comment confirms this JWT claim is NEVER
-- set (the app looks up organization_id from public.users instead —
-- see current_user_organization_id(), defined in migration 004) and
-- 007 replaced every other table's policies that used this broken
-- pattern with that helper function... except organizations.UPDATE,
-- which was missed.
--
-- Net effect: CompanyProfile.tsx's UPDATE to organizations goes
-- through the browser (RLS-bound) client and is gated by ONLY this
-- one broken policy — so it silently fails (0 rows updated, no
-- Postgres error) for every partner, every time. This migration
-- replaces it with the same current_user_organization_id() pattern
-- already used correctly everywhere else.
--
-- Also drops two other policies from 002 that are dead weight: the
-- subscriptions INSERT/UPDATE policies, which use the same broken JWT
-- claim and were functionally superseded by 007's
-- "Users can manage their organization's subscriptions" (FOR ALL)
-- policy. Postgres OR's multiple permissive policies together for the
-- same command, so the broken ones were never actually blocking
-- anything (007's correct policy already covers INSERT/UPDATE) — but
-- leaving a policy around that references a claim which is never set
-- is confusing for anyone reading pg_policies later, so it's cleaned
-- up here rather than left as silent dead weight.
--
-- Safe to re-run (uses IF EXISTS / OR REPLACE throughout).
-- ============================================================

-- ------------------------------------------------------------
-- 1. organizations — replace the broken UPDATE policy
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update their own organization" ON public.organizations;

CREATE POLICY "Users can update their own organization" ON public.organizations
    FOR UPDATE
    USING (id = public.current_user_organization_id())
    WITH CHECK (id = public.current_user_organization_id());

-- ------------------------------------------------------------
-- 2. subscriptions — drop the two dead policies from migration 002
--    (007's "Users can manage their organization's subscriptions"
--    already covers INSERT/UPDATE/DELETE correctly)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create subscriptions for their org" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update their organization's subscriptions" ON public.subscriptions;

-- ============================================================
-- VERIFY after running:
--
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where tablename in ('organizations', 'subscriptions')
--   order by tablename, cmd;
--
-- Expected on organizations: SELECT + UPDATE, both gated on
-- current_user_organization_id().
--
-- Expected on subscriptions: SELECT ("...view...") + ALL
-- ("...manage...") from migration 007, both gated on
-- current_user_organization_id(). No policy referencing
-- auth.jwt() -> 'user_metadata' should remain on either table.
--
-- Then manually re-test: log in as a partner, edit something in
-- Company Profile, save, and confirm it actually persists (reload
-- the page) — this is the concrete symptom this migration fixes.
-- ============================================================
