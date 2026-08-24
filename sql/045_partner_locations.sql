-- ============================================================
-- MIGRATION 045: partner location fields (Medical Logistics Map, part 1/3)
--
-- Phase 0 audit confirmed directly against production before writing
-- this file:
--   - partners_status_check  = ('active','inactive') only
--   - partners_category_check = ('Hospital','Clinic','Dental','Wellness',
--                                 'Spa','Hotel','Transport') only
--   - no existing index/function/table named anything this migration
--     (or 046/047) will create
--   - branches.latitude/longitude (from migration 001) has 0 rows with
--     data — confirmed dead/unused, NOT reused here. Location lives on
--     `partners` instead, since that's the single table the public
--     partner directory/detail pages (`fetchPartnerById`,
--     `fetchPartnersByCategory`) and admin (`PartnersManager.tsx`)
--     actually read/write.
--
-- Purely additive — no existing partners column is touched, dropped,
-- or redefined. Safe to re-run (IF NOT EXISTS throughout).
--
-- geom is a PLAIN column synced by trigger, NOT
-- `GENERATED ALWAYS AS (...) STORED`, because PostGIS has never been
-- exercised on this Supabase project before and a generated-column
-- failure at migration time is harder to debug than a trigger.
--
-- location_status defaults to 'pending' — a partner's coordinates are
-- never treated as public/trusted just because the Google Maps URL
-- resolved successfully. Admin must explicitly verify (Phase 3, admin
-- UI) before nearby_partners()/nearby_transit_points() (047) will
-- surface it on the public map.
-- ============================================================

-- ------------------------------------------------------------
-- 1) New columns on partners
-- ------------------------------------------------------------
ALTER TABLE public.partners
    ADD COLUMN IF NOT EXISTS google_maps_url TEXT,
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7),
    ADD COLUMN IF NOT EXISTS location_source TEXT,
    ADD COLUMN IF NOT EXISTS location_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS location_resolved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS location_verified_at TIMESTAMPTZ;

-- Constraints on the new columns (separate ADD CONSTRAINT so re-running
-- the ALTER TABLE above doesn't fail if columns already exist but the
-- constraint doesn't yet — DROP+ADD is the idempotent pattern used
-- elsewhere in this project, e.g. 038/039).
ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS partners_location_status_check;
ALTER TABLE public.partners ADD CONSTRAINT partners_location_status_check
    CHECK (location_status = ANY (ARRAY['pending', 'verified', 'rejected']));

ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS partners_location_source_check;
ALTER TABLE public.partners ADD CONSTRAINT partners_location_source_check
    CHECK (location_source IS NULL OR location_source = ANY (ARRAY['google_maps', 'admin_manual']));

-- Sanity bounds on lat/lng so obviously-corrupt values (e.g. a parsing
-- bug that swaps lat/lng) can't silently get stored. Thailand/Laos sit
-- roughly within these bounds with generous margin.
ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS partners_latitude_range_check;
ALTER TABLE public.partners ADD CONSTRAINT partners_latitude_range_check
    CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90));

ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS partners_longitude_range_check;
ALTER TABLE public.partners ADD CONSTRAINT partners_longitude_range_check
    CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180));

-- Both-or-neither: a half-set coordinate (e.g. latitude filled in but
-- longitude still NULL) is not a valid location. The sync trigger would
-- already leave geom NULL in that case, but this stops the bad state
-- from ever being written in the first place.
ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS partners_lat_lng_pair_check;
ALTER TABLE public.partners ADD CONSTRAINT partners_lat_lng_pair_check
    CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (latitude IS NOT NULL AND longitude IS NOT NULL)
    );

-- ------------------------------------------------------------
-- 2) PostGIS
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE public.partners
    ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(POINT, 4326);

-- ------------------------------------------------------------
-- 3) Trigger: keep geom in sync with latitude/longitude.
--    Runs on INSERT and on UPDATE OF latitude/longitude only (doesn't
--    fire on every unrelated partner edit, e.g. changing description
--    or rating).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_partner_geom()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    ELSE
        NEW.geom := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_partner_geom ON public.partners;
CREATE TRIGGER trg_sync_partner_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON public.partners
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_partner_geom();

-- ------------------------------------------------------------
-- 4) Index for radius queries (047 will use ST_DWithin against this)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS partners_geom_idx ON public.partners USING GIST (geom);

-- ------------------------------------------------------------
-- 5) Backfill: for any partner that already has lat/lng some other
--    way (shouldn't be any yet, but idempotent/safe), populate geom
--    directly rather than relying on the trigger via a no-op UPDATE.
-- ------------------------------------------------------------
UPDATE public.partners
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND geom IS NULL;

-- No new RLS policy needed: partners already has RLS enabled from
-- migration 006, and policies apply per-row, not per-column, so the
-- existing "public read active partners" / admin-write policies
-- already cover these new columns.

-- ============================================================
-- QA — run all of these after applying on staging. Every query below
-- must match the "expected" comment before moving on to 046.
-- ============================================================

-- Expected: 9 new columns (google_maps_url, address, latitude,
-- longitude, location_source, location_status, location_resolved_at,
-- location_verified_at, geom).
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'partners'
  AND column_name IN (
    'google_maps_url','address','latitude','longitude','location_source',
    'location_status','location_resolved_at','location_verified_at','geom'
  )
ORDER BY column_name;

-- Expected: NO rows. If this returns anything, a bad location_status
-- value slipped in somewhere.
SELECT id, name, location_status
FROM public.partners
WHERE location_status NOT IN ('pending', 'verified', 'rejected');

-- Expected: 0 (no partner has been given coordinates yet at this point
-- in the rollout — this migration only adds the columns/plumbing).
SELECT count(*) AS partners_with_geom
FROM public.partners
WHERE geom IS NOT NULL;

-- Manual trigger test — uncomment, run on a throwaway/staging row,
-- then revert. Confirms geom auto-populates and clears correctly.
-- UPDATE public.partners SET latitude = 13.7563, longitude = 100.5018
--   WHERE id = '<some staging partner id>';
-- SELECT id, latitude, longitude, ST_AsText(geom::geometry) FROM public.partners
--   WHERE id = '<same id>';
-- UPDATE public.partners SET latitude = NULL, longitude = NULL
--   WHERE id = '<same id>';
-- SELECT id, geom FROM public.partners WHERE id = '<same id>'; -- geom should be NULL again
