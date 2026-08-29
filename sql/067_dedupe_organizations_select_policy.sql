-- ============================================================
-- 067_dedupe_organizations_select_policy.sql
--
-- Finding (STEP 1 audit, live pg_policies dump): public.organizations
-- has two SELECT policies for `authenticated` that do the exact same
-- thing:
--   "Users can read own organization"   -- legacy inline subquery
--   "Users can view their own organization" -- current_user_organization_id()
--
-- Confirmed identical logic: current_user_organization_id() (migration
-- 004/007) is defined as exactly the same subquery
-- (select organization_id from public.users where supabase_user_id = auth.uid())
-- that the legacy policy inlines directly. Not a vulnerability --
-- Postgres OR's multiple permissive policies together, so this never
-- allowed anything extra -- just redundant, same pattern as the
-- partner-images duplicate policy already cleaned up.
--
-- Keeping "Users can view their own organization" since it matches the
-- helper-function convention used everywhere else (branches,
-- documents, patients, notifications, subscriptions, partner_bookings,
-- partner_packages).
-- ============================================================

DROP POLICY IF EXISTS "Users can read own organization" ON public.organizations;

-- Sanity check after applying, expected: exactly 1 row
--
-- select policyname
-- from pg_policies
-- where schemaname = 'public' and tablename = 'organizations' and cmd = 'SELECT';
