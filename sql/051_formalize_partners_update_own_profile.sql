-- ============================================================
-- MIGRATION 051: formalize undocumented "Partners can update own
-- profile" policy on public.partners
--
-- NOT urgent, NOT related to the 050 directory-visibility bug.
-- This is a UPDATE policy; 050 fixed a SELECT policy. Filed
-- separately on purpose so it doesn't get bundled with, or block,
-- the 050 fix.
--
-- Root cause: this policy exists on the live DB right now (confirmed
-- via the query in 999_dump_live_policies.sql, "KNOWN LOOSE END"
-- section) but was never CREATEd by any migration in this repo. It
-- was created directly on the Supabase Dashboard at some point before
-- 043 ran. 043 only ever did:
--
--   ALTER POLICY "Partners can update own profile"
--     ON public.partners TO authenticated;
--
-- wrapped in a DO block that silently no-ops if the policy doesn't
-- exist — so 043 was reacting to a policy it didn't create, and never
-- claimed to know its USING/WITH CHECK logic (see 043's own header
-- comment: guessing at qual and DROP+CREATE-ing it is exactly what
-- broke the `payments` policy earlier in this project).
--
-- Live qual/with_check, confirmed by pg_policies dump on 2026-08-24:
--   roles:      {authenticated}
--   cmd:        UPDATE
--   qual:       (id = current_user_partner_id())
--   with_check: (id = current_user_partner_id())
--
-- This migration does NOT change that logic. It only writes the
-- existing live definition into the repo so it stops being tribal
-- knowledge living solely on the dashboard. Purely documentation +
-- idempotency guarantee going forward — safe to run anytime.
-- ============================================================

DROP POLICY IF EXISTS "Partners can update own profile" ON public.partners;

CREATE POLICY "Partners can update own profile" ON public.partners
    FOR UPDATE
    TO authenticated
    USING (id = current_user_partner_id())
    WITH CHECK (id = current_user_partner_id());

-- ============================================================
-- QA — run after applying, as postgres/service_role.
-- ============================================================

-- (a) Confirm the policy now matches the pre-migration live state
-- exactly (same roles, same qual, same with_check) — this migration
-- should be a no-op in effect, only a no-op-in-behavior formalization.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partners' AND policyname = 'Partners can update own profile';
-- Expected: roles = {authenticated}, cmd = UPDATE,
-- qual = with_check = (id = current_user_partner_id())

-- (b) A partner should still only be able to update their own row.
-- As an authenticated partner user, attempt:
--   UPDATE public.partners SET name = name WHERE id = <own partner id>;
--   -- Expected: succeeds (1 row)
--   UPDATE public.partners SET name = name WHERE id = <a different partner id>;
--   -- Expected: 0 rows affected (blocked by USING/WITH CHECK), not an error
