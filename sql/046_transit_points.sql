-- ============================================================
-- MIGRATION 046: transit_points (Medical Logistics Map, part 2/3)
--
-- Border crossings and airports are NOT partners: they aren't
-- bookable businesses, have no owner, and don't fit
-- partners_category_check (Hospital/Clinic/Dental/Wellness/Spa/
-- Hotel/Transport). They're static reference data WOS staff maintain
-- directly — a handful of rows, not something onboarded through a
-- partner-facing form.
--
-- Purely additive — does not touch partners, orders, payments, or any
-- existing table. Idempotent (IF NOT EXISTS / DROP+ADD throughout).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transit_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_th TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_lo TEXT NOT NULL,
    type TEXT NOT NULL,
    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    geom GEOGRAPHY(POINT, 4326),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transit_points DROP CONSTRAINT IF EXISTS transit_points_type_check;
ALTER TABLE public.transit_points ADD CONSTRAINT transit_points_type_check
    CHECK (type = ANY (ARRAY['border_crossing', 'airport']));

ALTER TABLE public.transit_points DROP CONSTRAINT IF EXISTS transit_points_latitude_range_check;
ALTER TABLE public.transit_points ADD CONSTRAINT transit_points_latitude_range_check
    CHECK (latitude BETWEEN -90 AND 90);

ALTER TABLE public.transit_points DROP CONSTRAINT IF EXISTS transit_points_longitude_range_check;
ALTER TABLE public.transit_points ADD CONSTRAINT transit_points_longitude_range_check
    CHECK (longitude BETWEEN -180 AND 180);

-- Without this, `ON CONFLICT DO NOTHING` on the seed INSERT below is a
-- no-op guard: id is a fresh gen_random_uuid() every run, so nothing
-- would ever actually conflict, and re-running this migration would
-- silently duplicate all seed rows every time.
ALTER TABLE public.transit_points DROP CONSTRAINT IF EXISTS transit_points_unique_location;
ALTER TABLE public.transit_points ADD CONSTRAINT transit_points_unique_location
    UNIQUE (type, latitude, longitude);

-- ------------------------------------------------------------
-- geom: same pattern as partners in 045 — plain column + trigger,
-- not a generated column. lat/lng are NOT NULL here (unlike partners),
-- so geom is always populated on insert.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_transit_point_geom()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_transit_point_geom ON public.transit_points;
CREATE TRIGGER trg_sync_transit_point_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON public.transit_points
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_transit_point_geom();

CREATE INDEX IF NOT EXISTS transit_points_geom_idx ON public.transit_points USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_transit_points_type ON public.transit_points(type);

-- Defensive backfill: if this table somehow already existed with rows
-- before this migration ran (not the case today — Phase 0 confirmed
-- transit_points doesn't exist yet — but cheap insurance for any
-- future re-run scenario), make sure nothing is left with a stale or
-- missing geom before the trigger above takes over new writes.
UPDATE public.transit_points
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE geom IS NULL;

-- ------------------------------------------------------------
-- RLS — this is the piece that got missed in earlier drafts of this
-- brief. Without ENABLE + an explicit policy, a freshly created table
-- on this project either has no RLS (open to anon read/write via
-- PostgREST) or is fully locked (nothing readable at all), depending
-- on project-wide defaults — neither is what we want. We want: public
-- can read active points, only admin can write.
-- ------------------------------------------------------------
ALTER TABLE public.transit_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active transit points" ON public.transit_points;
CREATE POLICY "Public can read active transit points" ON public.transit_points
    FOR SELECT
    TO anon, authenticated
    USING (active = true);

-- Admin-only write. Matches the project's existing admin-check pattern
-- (requireAdmin at the API layer already gates access before any
-- Supabase call is made from an admin route/component); this policy is
-- the DB-level backstop, restricted to service_role writes only — no
-- anon/authenticated INSERT/UPDATE/DELETE policy is created here on
-- purpose, mirroring how admin-managed tables are locked down
-- elsewhere in this project (e.g. the 041 RLS hardening pass).
-- If the admin UI writes via the browser Supabase client instead of an
-- API route, add an authenticated-role policy scoped to an is-admin
-- check here instead of leaving it service_role-only.

-- ============================================================
-- Seed data — placeholder real-world points for TH<->LA crossings
-- and major airports used in the Medical Journey. Replace/extend with
-- confirmed coordinates before relying on this for production; these
-- are approximate and should be verified the same way partner
-- locations are (location_status-style review), even though this
-- table doesn't have its own verification workflow — it's small
-- enough to eyeball manually.
-- ============================================================
INSERT INTO public.transit_points (name_th, name_en, name_lo, type, latitude, longitude)
VALUES
    ('สะพานมิตรภาพไทย-ลาว 1 (หนองคาย)', 'Thai-Lao Friendship Bridge 1 (Nong Khai)', 'ຂົວມິດຕະພາບ ລາວ-ໄທ 1', 'border_crossing', 17.8814, 102.7134),
    ('ท่าอากาศยานนานาชาติวัตไต', 'Wattay International Airport', 'ສະໜາມບິນສາກົນວັດໄຕ', 'airport', 17.9883, 102.5633),
    ('ท่าอากาศยานนานาชาติอุดรธานี', 'Udon Thani International Airport', 'ສະໜາມບິນສາກົນອຸດອນທານີ', 'airport', 17.3864, 102.7881)
-- Conflict target matches transit_points_unique_location above, so
-- this is now genuinely idempotent: re-running this file will not
-- duplicate the seed rows.
ON CONFLICT (type, latitude, longitude) DO NOTHING;

-- ============================================================
-- QA — run after applying on staging, before moving to 047
-- ============================================================

-- Expected: table exists with RLS enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'transit_points';

-- Expected: exactly one SELECT policy, restricted to active = true
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'transit_points';

-- Expected: 3 seeded rows, all with geom populated (trigger fired on
-- insert since lat/lng are NOT NULL on this table)
SELECT name_en, type, latitude, longitude, geom IS NOT NULL AS has_geom
FROM public.transit_points
ORDER BY type, name_en;

-- Expected: no rows (type constraint holding)
SELECT id, type FROM public.transit_points
WHERE type NOT IN ('border_crossing', 'airport');

-- Expected: 3 (this migration is only run once with this seed set —
-- if it's ever re-run, this should still be 3, not 6/9/etc, now that
-- the unique constraint + explicit conflict target are in place)
SELECT count(*) AS transit_point_count FROM public.transit_points;

-- Expected: no rows (no two points share the exact same type+coordinates)
SELECT type, latitude, longitude, COUNT(*)
FROM public.transit_points
GROUP BY type, latitude, longitude
HAVING COUNT(*) > 1;

-- Expected: no rows (geom always agrees with the lat/lng columns it
-- was derived from)
SELECT id, name_en, latitude, longitude,
       ST_Y(geom::geometry) AS geom_latitude,
       ST_X(geom::geometry) AS geom_longitude
FROM public.transit_points
WHERE ST_Y(geom::geometry) <> latitude
   OR ST_X(geom::geometry) <> longitude;

-- Smoke test as anon would see it via PostgREST/RLS — run this with
-- the anon key in Supabase's SQL editor "Run as" / API tester, not
-- just as postgres superuser (superuser bypasses RLS and will always
-- show all rows regardless of policy correctness).
-- SELECT * FROM public.transit_points; -- as anon: should show only active=true rows
