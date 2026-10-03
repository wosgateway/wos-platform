-- ============================================================
-- 116_close_anon_rpc_and_rls_gaps.sql
--
-- Same root cause as 027: REVOKE ... FROM PUBLIC does not remove the
-- direct EXECUTE grants Supabase gives anon/authenticated on new
-- functions in schema public. Migrations 101, 113 and 114 relied on
-- FROM PUBLIC only. Confirmed by has_function_privilege() on the live
-- DB: these four were callable by anon AND authenticated.
--
-- Idempotent. Safe to re-run.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Close the four leaked SECURITY DEFINER RPCs.
--    Only the Next.js admin routes (service_role) call these; no
--    client-side code references them.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.start_partner_commercial_term_period(
    uuid, numeric, timestamptz, date, date, text, text, uuid
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_partner_onboarding_status()
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.cancel_mou_sign_request(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.expire_stale_mou_sign_requests()
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_partner_commercial_term_period(
    uuid, numeric, timestamptz, date, date, text, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_partner_onboarding_status()            TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_mou_sign_request(uuid, uuid, text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_mou_sign_requests()           TO service_role;

-- partner_mou_signed_at(uuid): 113 granted it to anon/authenticated
-- because calculate_order_item_commission() (SECURITY INVOKER) calls
-- it in the writer's role. But in the current codebase every write to
-- order_items runs as service_role or inside a SECURITY DEFINER RPC
-- (owner), and create_order_with_items is not executable by anon at
-- all (verified on the live DB), so no anon/authenticated session ever
-- fires that trigger. Least privilege: revoke.
-- NOTE: if a future RLS policy lets `authenticated` UPDATE the
-- commission-relevant columns of order_items directly, that write will
-- fail with "permission denied for function partner_mou_signed_at" --
-- re-grant to authenticated (or make the trigger function SECURITY
-- DEFINER) at that point.
REVOKE ALL ON FUNCTION public.partner_mou_signed_at(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_mou_signed_at(uuid) TO service_role;

-- ------------------------------------------------------------
-- 2. partner_payment_confirmations (104) had no RLS and no revokes.
--    No policies = no access for anon/authenticated; service_role
--    (used by /api/partner/payments/confirm-balance) bypasses RLS.
-- ------------------------------------------------------------
ALTER TABLE public.partner_payment_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_payment_confirmations FROM anon, authenticated;

-- ------------------------------------------------------------
-- 3. matchable_entity_types (074) is a public lookup table but had
--    RLS off, which left it writable through default table grants.
--    Keep it publicly readable, read-only.
-- ------------------------------------------------------------
ALTER TABLE public.matchable_entity_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matchable_entity_types_public_read ON public.matchable_entity_types;
CREATE POLICY matchable_entity_types_public_read
    ON public.matchable_entity_types
    FOR SELECT TO anon, authenticated
    USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.matchable_entity_types
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.matchable_entity_types TO anon, authenticated;

-- ------------------------------------------------------------
-- 4. partner_code (112): the BEFORE INSERT trigger runs as the
--    inserting role, but partner_code_seq grants USAGE to
--    service_role only. PartnersManager.tsx inserts partners from the
--    browser as `authenticated`, so that insert fails with
--    "permission denied for sequence partner_code_seq".
--    Fix: the trigger function runs as its owner.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_partner_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.partner_code IS NULL THEN
    NEW.partner_code := public.generate_partner_code(NEW.category);
  END IF;
  RETURN NEW;
END;
$$;

-- Nobody should be able to burn sequence numbers via /rpc.
REVOKE ALL ON FUNCTION public.generate_partner_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_partner_code()       FROM PUBLIC, anon, authenticated;

COMMIT;

-- ------------------------------------------------------------
-- Verify after applying (expect anon_can/auth_can = false for the
-- four functions above, relrowsecurity = true for both tables):
--
--   select p.oid::regprocedure fn,
--          has_function_privilege('anon',p.oid,'EXECUTE') anon_can,
--          has_function_privilege('authenticated',p.oid,'EXECUTE') auth_can
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and p.prosecdef order by 1;
--
--   select relname, relrowsecurity from pg_class
--   where relname in ('partner_payment_confirmations','matchable_entity_types');
--
-- ------------------------------------------------------------
-- OPTIONAL, run separately as the postgres role: stop this class of
-- bug from recurring. Affects only functions created AFTER this runs;
-- any future RLS helper function must then be granted to
-- `authenticated` explicitly.
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
-- ------------------------------------------------------------
