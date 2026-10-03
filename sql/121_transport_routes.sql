-- ============================================================
-- 121_transport_routes.sql
--
-- CONTEXT: WOS Partner Inventory Portal — Transport Group, Phase 5
-- (Service Routes). Apply AFTER 120 (same SECURITY DEFINER guard
-- pattern; 120 fixes the identical bug in the 118/119 guards).
--
-- CONTRACT (frozen before writing this file):
--   1. Origin/destination are canonical location codes from a small
--      lookup table, never free text. Six codes:
--        nongkhai_bridge, nakhon_phanom_bridge, mukdahan_bridge,
--        chong_mek, udon_airport, wattay_airport
--      Deliberately NOT included: hotel, other, per_itinerary — those
--      are customer-specific labels in the booking form, not physical
--      transport points a partner can operate a fixed route between.
--   2. Routes are directional. "nongkhai_bridge -> udon_airport" and
--      "udon_airport -> nongkhai_bridge" are two rows.
--   3. round_trip is a booking concept (see 096), NOT a route
--      attribute. Nothing here models legs or return trips.
--   4. Reference/configuration layer only, like room_availability
--      (118) and vehicles (119): NOT read by create_order_with_items()
--      or admin_assign_order_item(), NOT read by any public page.
--      No price lives here — pricing authority stays with packages
--      until the production Transport pricing audit is done
--      (rates table = migration 122, deliberately not written yet).
--
-- Why a lookup table instead of a CHECK list: labels (th/en/lo) are
-- needed by the partner UI anyway, and adding a seventh point later
-- is an INSERT, not a schema migration. It is NOT linked to
-- transit_points (046/055): that table has no Chong Mek and uses its
-- own naming; reconciling the two vocabularies is a separate task.
--
-- Idempotent at object-definition level (IF NOT EXISTS / OR REPLACE /
-- DROP+CREATE POLICY / ON CONFLICT). Safe to re-run against the same
-- schema state. Existing incompatible objects are not migrated by
-- IF NOT EXISTS (CREATE TABLE IF NOT EXISTS does not verify that an
-- already-existing table matches this definition).
--
-- DELIBERATELY OUT OF SCOPE (do not add here):
--   - vehicle_type on a route (belongs to rates/service capability)
--   - price, round_trip, booking_id, package_id on a route
--   - public/anon SELECT on transport_routes (routes are a partner
--     configuration layer, not a customer-facing catalog yet)
--   - any partners.status check in RLS. A partner with
--     status='inactive' keeps managing its own routes exactly as it
--     does for vehicles (119) and availability (118): 120 fixed the
--     category LOOKUP, not lifecycle permissions. If inactive/
--     suspended partners must be blocked from editing inventory, that
--     is one separate partner-status authorization policy applied
--     consistently to packages, room_availability, vehicles and
--     transport_routes — not something to hide inside this migration.
--
-- TECH DEBT (tracked, not fixed here):
--   transit_points (046/055)  !=  transport_locations (this file).
--   Two vocabularies now overlap (Nong Khai bridge, Udon airport,
--   Wattay) and transit_points has no Chong Mek. Merging them risks
--   the production booking/customer flow, so reconciliation is a
--   separate task with its own blast-radius review.
-- ============================================================

-- ------------------------------------------------------------
-- 1. transport_locations — the canonical vocabulary
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transport_locations (
    code TEXT PRIMARY KEY,
    name_th TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_lo TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_transport_locations_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);

-- NOTE: Lao labels below need a native-speaker review before they are
-- shown to Lao partners; Thai/English are the reference.
INSERT INTO public.transport_locations (code, name_th, name_en, name_lo, sort_order) VALUES
    ('nongkhai_bridge',      'สะพานมิตรภาพไทย-ลาว แห่งที่ 1 (หนองคาย)',         'Thai-Lao Friendship Bridge 1 (Nong Khai)',         'ຂົວມິດຕະພາບ ລາວ-ໄທ ແຫ່ງທີ 1 (ໜອງຄາຍ)',       10),
    ('mukdahan_bridge',      'สะพานมิตรภาพไทย-ลาว แห่งที่ 2 (มุกดาหาร)',        'Thai-Lao Friendship Bridge 2 (Mukdahan)',          'ຂົວມິດຕະພາບ ລາວ-ໄທ ແຫ່ງທີ 2 (ມຸກດາຫານ)',     20),
    ('nakhon_phanom_bridge', 'สะพานมิตรภาพไทย-ลาว แห่งที่ 3 (นครพนม)',         'Thai-Lao Friendship Bridge 3 (Nakhon Phanom)',     'ຂົວມິດຕະພາບ ລາວ-ໄທ ແຫ່ງທີ 3 (ນະຄອນພະນົມ)',   30),
    ('chong_mek',            'ด่านช่องเม็ก (อุบลราชธานี)',                        'Chong Mek Border Checkpoint (Ubon Ratchathani)',   'ດ່ານຊ່ອງເມັກ',                                 40),
    ('udon_airport',         'ท่าอากาศยานอุดรธานี',                              'Udon Thani International Airport',                 'ສະໜາມບິນສາກົນອຸດອນທານີ',                       50),
    ('wattay_airport',       'ท่าอากาศยานวัดไต (เวียงจันทน์)',                    'Wattay International Airport (Vientiane)',         'ສະໜາມບິນສາກົນວັດໄຕ',                           60)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.transport_locations ENABLE ROW LEVEL SECURITY;

-- Reference data, same posture as transit_points (046) and
-- transport_vehicle_pricing (081): readable by anyone, active rows only.
DROP POLICY IF EXISTS "Public can read active transport locations" ON public.transport_locations;
CREATE POLICY "Public can read active transport locations" ON public.transport_locations
    FOR SELECT TO anon, authenticated
    USING (is_active = true);

DROP POLICY IF EXISTS "Platform admins can manage transport locations" ON public.transport_locations;
CREATE POLICY "Platform admins can manage transport locations" ON public.transport_locations
    FOR ALL TO authenticated
    USING (public.is_platform_admin())
    WITH CHECK (public.is_platform_admin());

-- Default Supabase grants would let anon write-attempt (blocked by RLS,
-- but TRUNCATE bypasses RLS entirely) — see 116 section 3.
REVOKE ALL ON public.transport_locations FROM anon;
GRANT SELECT ON public.transport_locations TO anon;
REVOKE TRUNCATE ON public.transport_locations FROM authenticated;

-- ------------------------------------------------------------
-- 2. transport_routes — partner-owned directional routes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transport_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,

    origin_code TEXT NOT NULL
        REFERENCES public.transport_locations(code) ON UPDATE CASCADE ON DELETE RESTRICT,
    destination_code TEXT NOT NULL
        REFERENCES public.transport_locations(code) ON UPDATE CASCADE ON DELETE RESTRICT,

    -- Partner-controlled on/off switch (same pattern as vehicles /
    -- packages.is_active): hide a route without losing it.
    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_transport_routes_origin_ne_destination CHECK (origin_code <> destination_code),
    -- One row per partner per direction.
    CONSTRAINT uq_transport_routes_partner_direction UNIQUE (partner_id, origin_code, destination_code)
);

-- uq_ index already covers (partner_id, ...) lookups; add the reverse
-- shape for "which partners serve A -> B" queries in later phases.
CREATE INDEX IF NOT EXISTS idx_transport_routes_direction
    ON public.transport_routes(origin_code, destination_code);

DROP TRIGGER IF EXISTS set_updated_at_transport_routes ON public.transport_routes;
CREATE TRIGGER set_updated_at_transport_routes
  BEFORE UPDATE ON public.transport_routes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Transport-only guard. SECURITY DEFINER from the start (see 120):
-- partners is only visible to `authenticated` when status='active'.
CREATE OR REPLACE FUNCTION public.check_transport_routes_transport_only()
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
      'transport_routes.partner_id % has no partner row — cannot verify category',
      NEW.partner_id;
  END IF;

  IF v_category IS DISTINCT FROM 'Transport' THEN
    RAISE EXCEPTION
      'transport_routes.partner_id % belongs to a non-Transport partner (category=%) — this table is Transport-only',
      NEW.partner_id,
      v_category;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_transport_routes_transport_only()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS transport_routes_transport_only ON public.transport_routes;
CREATE TRIGGER transport_routes_transport_only
  BEFORE INSERT OR UPDATE OF partner_id ON public.transport_routes
  FOR EACH ROW EXECUTE FUNCTION public.check_transport_routes_transport_only();

ALTER TABLE public.transport_routes ENABLE ROW LEVEL SECURITY;

-- Same ownership shape as vehicles (119) / packages (041).
DROP POLICY IF EXISTS "Partners can manage their own transport routes" ON public.transport_routes;
CREATE POLICY "Partners can manage their own transport routes" ON public.transport_routes
    FOR ALL TO authenticated
    USING (
        partner_id IN (
            SELECT b.partner_id
            FROM public.users u
            JOIN public.branches b ON b.id = u.branch_id
            WHERE u.supabase_user_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        partner_id IN (
            SELECT b.partner_id
            FROM public.users u
            JOIN public.branches b ON b.id = u.branch_id
            WHERE u.supabase_user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Platform admins can manage all transport routes" ON public.transport_routes;
CREATE POLICY "Platform admins can manage all transport routes" ON public.transport_routes
    FOR ALL TO authenticated
    USING (public.is_platform_admin())
    WITH CHECK (public.is_platform_admin());

-- No anon access at all (no policy + revoke), no public read yet.
REVOKE ALL ON public.transport_routes FROM anon;
REVOKE TRUNCATE ON public.transport_routes FROM authenticated;

-- ============================================================
-- QA — Supabase SQL editor as postgres, STAGING only. Every write
-- test is BEGIN ... ROLLBACK. Placeholders:
--   <transport_partner_id>  partner with category='Transport'
--   <hotel_partner_id>      partner with category='Hotel'
--   <transport_user_uid>    users.supabase_user_id on <transport_partner_id>
--   <other_route_id>        a transport_routes row of ANOTHER Transport partner
-- For blocks that use set_config + SET LOCAL ROLE: run SELECT auth.uid()
-- first; if it does not return the uid, that block is INVALID (see the
-- caveat in 120). The Partner Portal is the authoritative check.
-- ============================================================

-- (a) Seed. Expected: exactly 6 rows, all active.
SELECT code, is_active FROM public.transport_locations ORDER BY sort_order;

-- (b) Guard function properties + owner. Expected: prosecdef = true,
--     search_path=public, bypasses_rls = true, and 0 rows from the
--     second query.
SELECT p.proname, p.prosecdef, p.proconfig,
       (r.rolsuper OR r.rolbypassrls) AS bypasses_rls
FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'check_transport_routes_transport_only';

SELECT r.rolname
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated')
  AND has_function_privilege(r.rolname,
        'public.check_transport_routes_transport_only()'::regprocedure, 'EXECUTE');

-- (c) Constraints, as postgres. Each expected result in comment.
-- BEGIN;  -- origin = destination -> ERROR chk_transport_routes_origin_ne_destination
--   INSERT INTO public.transport_routes (partner_id, origin_code, destination_code)
--   VALUES ('<transport_partner_id>', 'udon_airport', 'udon_airport');
-- ROLLBACK;
-- BEGIN;  -- unknown code -> ERROR foreign key violation (no free text)
--   INSERT INTO public.transport_routes (partner_id, origin_code, destination_code)
--   VALUES ('<transport_partner_id>', 'hotel', 'udon_airport');
-- ROLLBACK;
-- BEGIN;  -- duplicate direction -> 2nd insert ERROR uq_transport_routes_partner_direction;
--         -- reverse direction -> allowed (INSERT 0 1)
--   INSERT INTO public.transport_routes (partner_id, origin_code, destination_code)
--   VALUES ('<transport_partner_id>', 'nongkhai_bridge', 'udon_airport');
--   INSERT INTO public.transport_routes (partner_id, origin_code, destination_code)
--   VALUES ('<transport_partner_id>', 'udon_airport', 'nongkhai_bridge');
--   INSERT INTO public.transport_routes (partner_id, origin_code, destination_code)
--   VALUES ('<transport_partner_id>', 'nongkhai_bridge', 'udon_airport');
-- ROLLBACK;
-- BEGIN;  -- non-Transport partner -> ERROR "non-Transport partner (category=Hotel)"
--   INSERT INTO public.transport_routes (partner_id, origin_code, destination_code)
--   VALUES ('<hotel_partner_id>', 'nongkhai_bridge', 'udon_airport');
-- ROLLBACK;

-- (d) Inactive partner — two DIFFERENT things, tested separately.
--     Prep for d1-d3: set the Transport partner inactive (inside each
--     block; all rolled back). d1 and d2 need the auth.uid() check.
--
--  (d1) PRECONDITION — proves the old bug class applies: as
--       `authenticated`, an inactive partner's row is invisible.
--       Expected: 0 rows. (If this returns 1 row, d2 proves nothing.)
-- BEGIN;
--   UPDATE public.partners SET status = 'inactive' WHERE id = '<transport_partner_id>';
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<transport_user_uid>', 'role', 'authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT auth.uid();  -- must equal <transport_user_uid>
--   SELECT id, category FROM public.partners WHERE id = '<transport_partner_id>';
-- ROLLBACK;
--
--  (d2) B — SECURITY DEFINER trigger: the guard can still read
--       partners.category even though d1 shows the caller cannot.
--       Expected: INSERT 0 1 (an invoker-rights guard would raise
--       "category=<NULL>" here).
-- BEGIN;
--   UPDATE public.partners SET status = 'inactive' WHERE id = '<transport_partner_id>';
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<transport_user_uid>', 'role', 'authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT auth.uid();
--   INSERT INTO public.transport_routes (partner_id, origin_code, destination_code)
--   VALUES ('<transport_partner_id>', 'chong_mek', 'udon_airport');
-- ROLLBACK;
--
--  (d3) A — RLS ownership (unchanged by 120/121): an inactive partner
--       can still UPDATE its own existing route. Expected: UPDATE 1.
--       This documents current behavior on purpose; see the
--       out-of-scope note in the header.
-- BEGIN;
--   INSERT INTO public.transport_routes (partner_id, origin_code, destination_code)
--   VALUES ('<transport_partner_id>', 'chong_mek', 'udon_airport');
--   UPDATE public.partners SET status = 'inactive' WHERE id = '<transport_partner_id>';
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<transport_user_uid>', 'role', 'authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT auth.uid();
--   UPDATE public.transport_routes SET is_active = false
--   WHERE partner_id = '<transport_partner_id>'
--     AND origin_code = 'chong_mek' AND destination_code = 'udon_airport';
-- ROLLBACK;
--
-- If SQL-editor simulation of auth.uid() does not work, do not force
-- it: use the Partner Portal on staging as the authoritative test.

-- (e) Cross-partner isolation. As the Transport user, UPDATE / DELETE
--     another partner's route. Expected: UPDATE 0 and DELETE 0.
-- BEGIN;
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<transport_user_uid>', 'role', 'authenticated')::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT auth.uid();
--   UPDATE public.transport_routes SET is_active = false WHERE id = '<other_route_id>';
--   DELETE FROM public.transport_routes WHERE id = '<other_route_id>';
-- ROLLBACK;

-- (f) anon: locations readable, routes not. Expected: 6 rows, then
--     permission denied (or 0 rows).
-- BEGIN;
--   SET LOCAL ROLE anon;
--   SELECT count(*) FROM public.transport_locations;
--   SELECT count(*) FROM public.transport_routes;
-- ROLLBACK;
