-- ============================================================
-- MIGRATION 027: close the anon/authenticated EXECUTE hole on every
-- admin/payment SECURITY DEFINER RPC function shipped so far.
--
-- ROOT CAUSE: every prior migration (016, 017, 018, 022, 025, 026)
-- locks down its RPC function with:
--
--     REVOKE ALL ON FUNCTION public.fn(...) FROM PUBLIC;
--     GRANT EXECUTE ON FUNCTION public.fn(...) TO service_role;
--
-- This looks complete but isn't: Supabase projects commonly have a
-- database-level ALTER DEFAULT PRIVILEGES rule that auto-grants
-- EXECUTE on every new function in the public schema to `anon` and
-- `authenticated` at CREATE FUNCTION time (so PostgREST can expose
-- them by default). Those are grants held DIRECTLY by anon/
-- authenticated, not inherited via the PUBLIC pseudo-role €” so
-- `REVOKE ALL ... FROM PUBLIC` never touches them. Confirmed via:
--
--   select routine_name, grantee, privilege_type
--   from information_schema.role_routine_grants
--   where routine_name = 'admin_update_order_item_schedule'
--     and grantee in ('anon','authenticated');
--
-- IMPACT: every function below is SECURITY DEFINER, and the actual
-- admin/partner auth check (requireAdmin() / partner session check)
-- lives only in the Next.js API route that calls it €” NOT inside the
-- function itself. With EXECUTE granted to anon/authenticated, any
-- browser holding the public anon key can call these directly via
-- `supabase.rpc(...)`, bypassing the Next.js auth layer entirely.
-- For admin_verify_payment / partner_verify_payment /
-- admin_assign_order_item / admin_update_order_item_schedule this
-- means an unauthenticated caller could mark arbitrary payments
-- verified, reassign order items, or edit schedules. This is exactly
-- the class of test listed as NOT YET DONE in "Priority 2 €” Payment
-- Security Test" in the handoff doc.
--
-- FIX: explicitly revoke from anon AND authenticated (not just
-- PUBLIC) on every affected function, then re-assert the
-- service_role-only grant. Safe to re-run €” REVOKE on a grant that
-- doesn't exist is a no-op, not an error.
--
-- create_order_with_items() is parameterized 4 args per migration
-- 025 (UUID, JSONB, TEXT, TEXT) €” signature included explicitly since
-- Postgres requires the exact arg list to identify the function.
-- ============================================================

REVOKE ALL ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_verify_payment(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_verify_payment(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.partner_verify_payment(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_verify_payment(UUID, UUID, BOOLEAN)
  TO service_role;

REVOKE ALL ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_update_order_item_schedule(
    UUID, UUID, DATE, TIME, DATE, DATE, TIME, TEXT, TEXT
  ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_order_item_schedule(
    UUID, UUID, DATE, TIME, DATE, DATE, TIME, TEXT, TEXT
  ) TO service_role;

-- ------------------------------------------------------------
-- š ï¸ MANUAL STEP €” check for OTHER functions this migration doesn't
-- know about. Every SECURITY DEFINER function in public that was
-- created before someone knew about the default-privilege behavior
-- above is a candidate. Run this to find any not covered by the list
-- above:
--
--   select p.proname, r.grantee
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   join information_schema.role_routine_grants r
--     on r.routine_name = p.proname
--   where n.nspname = 'public'
--     and p.prosecdef = true
--     and r.grantee in ('anon', 'authenticated');
--
-- Also check whether the project's ALTER DEFAULT PRIVILEGES rule
-- itself should be changed so this doesn't recur on every future
-- admin_*/partner_* function migration:
--
--   select defaclrole::regrole, defaclnamespace::regnamespace,
--          defaclobjtype, defaclacl
--   from pg_default_acl
--   where defaclnamespace = 'public'::regnamespace;
--
-- If it shows EXECUTE granted to anon/authenticated by default for
-- functions, consider narrowing it (e.g. revoke the default and grant
-- explicitly per-function going forward) so a future migration that
-- forgets this issue doesn't reopen the hole.
-- ------------------------------------------------------------
