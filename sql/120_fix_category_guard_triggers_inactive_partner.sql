-- ============================================================
-- 120_fix_category_guard_triggers_inactive_partner.sql
--
-- PRE-FLIGHT (run BEFORE applying, as postgres). SECURITY DEFINER only
-- helps if the function owner bypasses RLS on public.partners /
-- public.packages. Expected for both rows: rolbypassrls = true
-- (or rolsuper = true). If rolbypassrls = false for the owner: STOP,
-- do not apply this migration.
--
--   SELECT p.oid::regprocedure AS function_name,
--          r.rolname AS owner, r.rolsuper, r.rolbypassrls
--   FROM pg_proc p
--   JOIN pg_roles r ON r.oid = p.proowner
--   WHERE p.pronamespace = 'public'::regnamespace
--     AND p.proname IN ('check_room_availability_hotel_only',
--                       'check_vehicles_transport_only');
--
-- BUG (found reviewing 118/119): check_room_availability_hotel_only()
-- (118) and check_vehicles_transport_only() (119) were SECURITY
-- INVOKER, so they read public.partners as the `authenticated` role.
-- The only SELECT policy on partners is "public read active partners"
-- USING (status = 'active') (006/048/050), and partners have no
-- self-read policy (065). Result: for a partner whose status is
-- 'inactive' (e.g. suspended via /api/admin/partners/[id]/suspend),
-- the category lookup returned no row, v_category was NULL, and every
-- INSERT/UPDATE on room_availability / vehicles failed with a
-- misleading "belongs to a non-Hotel/non-Transport partner
-- (category=<NULL>)" error.
--
-- FIX: run both guards with the function owner's security context
-- (SECURITY DEFINER + pinned search_path, same pattern as
-- assign_partner_code() in 116), and raise a distinct message when
-- the package/partner row cannot be found.
--
-- These functions are trigger-only and are intentionally not
-- executable directly by PUBLIC/anon/authenticated. The trigger
-- invokes them using the function's security context.
--
-- NOT changed here: RLS policies, trigger definitions, other tables.
--
-- NOTE (app side): vehicles/page.tsx and availability/page.tsx fetch
-- partners.category with the user's session, so an inactive partner
-- still sees the "wrong category" notice on those pages. Separate UI
-- change if wanted.
--
-- Idempotent at function-definition level. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_room_availability_hotel_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category TEXT;
BEGIN
  SELECT p.category
    INTO v_category
  FROM public.packages pkg
  JOIN public.partners p
    ON p.id = pkg.partner_id
  WHERE pkg.id = NEW.package_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'room_availability.package_id % has no package/partner row — cannot verify category',
      NEW.package_id;
  END IF;

  IF v_category IS DISTINCT FROM 'Hotel' THEN
    RAISE EXCEPTION
      'room_availability.package_id % belongs to a non-Hotel partner (category=%) — this table is Hotel-only for now',
      NEW.package_id,
      v_category;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_vehicles_transport_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category TEXT;
BEGIN
  SELECT p.category
    INTO v_category
  FROM public.partners p
  WHERE p.id = NEW.partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'vehicles.partner_id % has no partner row — cannot verify category',
      NEW.partner_id;
  END IF;

  IF v_category IS DISTINCT FROM 'Transport' THEN
    RAISE EXCEPTION
      'vehicles.partner_id % belongs to a non-Transport partner (category=%) — this table is Transport-only for now',
      NEW.partner_id,
      v_category;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_room_availability_hotel_only()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.check_vehicles_transport_only()
  FROM PUBLIC, anon, authenticated;

-- ============================================================
-- QA — run in the Supabase SQL editor as postgres, on STAGING.
-- Every test block is BEGIN ... ROLLBACK, nothing persists.
-- Placeholders:
--   <transport_partner_id>   partner with category='Transport'
--   <transport_user_uid>     users.supabase_user_id of a user whose
--                            branch.partner_id = <transport_partner_id>
--   <other_vehicle_id>       a vehicles row owned by a DIFFERENT partner
--   <hotel_partner_id>       partner with category='Hotel'
--   <hotel_user_uid>         users.supabase_user_id of a user on that hotel
--   <hotel_package_id>       packages row owned by <hotel_partner_id>
-- ============================================================

-- (a) Function properties. Expected: prosecdef = true, proconfig has
--     search_path=public, for both rows.
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('check_room_availability_hotel_only', 'check_vehicles_transport_only');

-- (b) Expected: 0 rows (anon/authenticated cannot EXECUTE directly).
SELECT p.proname, r.rolname
FROM pg_proc p
CROSS JOIN pg_roles r
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('check_room_availability_hotel_only', 'check_vehicles_transport_only')
  AND r.rolname IN ('anon', 'authenticated')
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');

-- (c) REAL PATH: inactive Transport partner, acting as its own user
--     through `authenticated` + RLS. Expected: INSERT 0 1.
--     (Before 120 this failed with category=<NULL>.)
-- BEGIN;
--   UPDATE public.partners SET status = 'inactive' WHERE id = '<transport_partner_id>';
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<transport_user_uid>', 'role', 'authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   INSERT INTO public.vehicles (partner_id, vehicle_type, name)
--   VALUES ('<transport_partner_id>', 'sedan', 'QA 120 inactive transport');
-- ROLLBACK;

-- (d) Same path, wrong category. As the Hotel user, insert a vehicle
--     for the Hotel partner. Expected: ERROR "non-Transport partner
--     (category=Hotel)" (not a silent success, not category=<NULL>).
-- BEGIN;
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<hotel_user_uid>', 'role', 'authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   INSERT INTO public.vehicles (partner_id, vehicle_type, name)
--   VALUES ('<hotel_partner_id>', 'sedan', 'QA 120 wrong category');
-- ROLLBACK;

-- (e) Hotel guard, real path. As the Hotel user, insert availability
--     for own package. Expected: INSERT 0 1. Then as the Transport
--     user on a Transport-owned package: RLS/guard must reject.
-- BEGIN;
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<hotel_user_uid>', 'role', 'authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   INSERT INTO public.room_availability (package_id, date, available_count)
--   VALUES ('<hotel_package_id>', current_date, 1);
-- ROLLBACK;

-- (f) Cross-partner isolation (RLS unchanged). As the Transport user,
--     UPDATE a vehicle belonging to another partner.
--     Expected: UPDATE 0 (and DELETE 0).
-- BEGIN;
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<transport_user_uid>', 'role', 'authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   UPDATE public.vehicles SET name = 'hijack' WHERE id = '<other_vehicle_id>';
--   DELETE FROM public.vehicles WHERE id = '<other_vehicle_id>';
-- ROLLBACK;
