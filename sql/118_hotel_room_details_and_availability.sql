-- ============================================================
-- 118_hotel_room_details_and_availability.sql
--
-- CONTEXT: WOS Partner Inventory Portal — Transportation & Hotel
-- Pilot brief, Phase 1-3 (Hotel side only; Transport is a later,
-- separate migration — see brief section 14).
--
-- Phase 1 — richer Room Type fields on `packages` (still the same
-- table Hotel partners already use via category='Hotel' +
-- sub_category as room type, migration 082). Purely additive:
-- max_guests, amenities, gallery_urls. No existing column is
-- renamed or repurposed, so every non-hotel category (Transport,
-- Clinic, Wellness, ...) is completely unaffected — these columns
-- are simply NULL/empty for them, same pattern as sub_category.
--
-- Phase 2 — `room_availability`: a genuinely new table. Today
-- `packages` has no date-based inventory at all — only a single
-- is_active on/off switch and a per-order room_quantity multiplier
-- (migration 028). This table is the first real calendar: for a
-- given room (package) and date, how many rooms are open and
-- (optionally) an overridden price for that date — same shape as
-- Agoda YCS's "Rate and Allotment" calendar.
--
-- Deliberately NOT wired into create_order_with_items() or the
-- public booking flow yet — that would mean checking/decrementing
-- availability at booking time, which touches the same "never
-- trust the client for anything that affects price/scope" surface
-- as migrations 028/036/037. That's real, separate work (needs its
-- own atomicity story, same as the room_quantity guard) and is
-- explicitly follow-up, not part of this migration. For this pilot
-- phase, room_availability is read/write for the partner (and read
-- for admin) as a planning/reference calendar only.
--
-- Idempotent (IF NOT EXISTS / DROP+CREATE POLICY throughout), same
-- pattern as 045/046/047/074/081. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- Phase 1: structured Room Type fields on packages
-- ------------------------------------------------------------

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS max_guests INTEGER;

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS chk_packages_max_guests_positive;
ALTER TABLE public.packages
  ADD CONSTRAINT chk_packages_max_guests_positive CHECK (max_guests IS NULL OR max_guests > 0);

COMMENT ON COLUMN public.packages.max_guests IS
  'Hotel-only: max occupancy for this room type. NULL for every other partners.category. Not enforced against room_quantity/order at booking time — display/reference field only, same status as sub_category.';

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS amenities JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.packages.amenities IS
  'Hotel-only: array of short amenity strings the partner picks from a fixed UI checklist (e.g. ["breakfast","wifi","aircon"]) — see AMENITY_OPTIONS in PackagesManager.tsx, which is the source of truth for valid values (no CHECK constraint, same free-text-UI-enforced pattern as sub_category/vehicle_type). Empty array, not NULL, when nothing selected or for non-hotel categories.';

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS gallery_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.packages.gallery_urls IS
  'Additional photos beyond image_url (the existing single cover photo). Array of public URLs in the partner-images bucket, same upload path/RLS as image_url — see handleImageUpload in PackagesManager.tsx. Not category-restricted (any partner could use extra gallery photos later), but only the Hotel room form exposes the upload UI for it today.';

-- ------------------------------------------------------------
-- Phase 2: room_availability calendar
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.room_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
    date DATE NOT NULL,

    -- How many rooms of this type are open on this date. 0 is a
    -- valid, meaningful value ("sold out this date") — distinct
    -- from no row existing at all ("partner hasn't set this date
    -- yet", treated as "unknown/unlimited" by the UI, not "zero").
    available_count INTEGER NOT NULL DEFAULT 0,

    -- NULL = use packages.original_price / special_price as-is for
    -- this date. Set = this date's price overrides both, same
    -- "override, don't replace" relationship transport_vehicle_pricing
    -- has to the base vehicle_type price (migration 081).
    price_override NUMERIC(10, 2),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_room_availability_count_non_negative CHECK (available_count >= 0),
    CONSTRAINT chk_room_availability_price_positive CHECK (price_override IS NULL OR price_override > 0),
    -- One row per room per date — partner UI upserts on this, never
    -- inserts a second row for the same (package_id, date).
    CONSTRAINT uq_room_availability_package_date UNIQUE (package_id, date)
);

CREATE INDEX IF NOT EXISTS idx_room_availability_package_id ON public.room_availability(package_id);
CREATE INDEX IF NOT EXISTS idx_room_availability_date ON public.room_availability(date);

DROP TRIGGER IF EXISTS set_updated_at_room_availability ON public.room_availability;
CREATE TRIGGER set_updated_at_room_availability
  BEFORE UPDATE ON public.room_availability
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Guard: only meaningful for Hotel-category partners today (same
-- "reject at the DB layer, don't just hide it in the UI" instinct as
-- migration 028's room_quantity hotel-only guard). Pilot scope is
-- Hotel only — if Transport or another category later gets its own
-- date-based capacity, that's transport's `vehicle_availability`
-- table (separate migration, separate shape), not this one.
CREATE OR REPLACE FUNCTION public.check_room_availability_hotel_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_category TEXT;
BEGIN
  SELECT p.category INTO v_category
  FROM public.packages pkg
  JOIN public.partners p ON p.id = pkg.partner_id
  WHERE pkg.id = NEW.package_id;

  IF v_category IS DISTINCT FROM 'Hotel' THEN
    RAISE EXCEPTION 'room_availability.package_id % belongs to a non-Hotel partner (category=%) — this table is Hotel-only for now', NEW.package_id, v_category;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS room_availability_hotel_only ON public.room_availability;
CREATE TRIGGER room_availability_hotel_only
  BEFORE INSERT OR UPDATE OF package_id ON public.room_availability
  FOR EACH ROW EXECUTE FUNCTION public.check_room_availability_hotel_only();

ALTER TABLE public.room_availability ENABLE ROW LEVEL SECURITY;

-- Same ownership check as "Partners can manage their own packages"
-- (migration 041) — joins through packages rather than duplicating
-- a denormalized partner_id column on this table, since a room's
-- ownership is exactly its package's ownership and the two can never
-- diverge (package_id is NOT NULL + FK).
DROP POLICY IF EXISTS "Partners can manage their own room availability" ON public.room_availability;
CREATE POLICY "Partners can manage their own room availability" ON public.room_availability
    FOR ALL TO authenticated
    USING (
        package_id IN (
            SELECT pkg.id
            FROM public.packages pkg
            JOIN public.users u ON u.supabase_user_id = (SELECT auth.uid())
            JOIN public.branches b ON b.id = u.branch_id
            WHERE pkg.partner_id = b.partner_id
        )
    )
    WITH CHECK (
        package_id IN (
            SELECT pkg.id
            FROM public.packages pkg
            JOIN public.users u ON u.supabase_user_id = (SELECT auth.uid())
            JOIN public.branches b ON b.id = u.branch_id
            WHERE pkg.partner_id = b.partner_id
        )
    );

-- Platform admins: read/write everything, reusing the same
-- is_platform_admin() helper "Platform admins can manage all
-- packages" (migration 053) is built on — not re-deriving the admin
-- check by hand here.
DROP POLICY IF EXISTS "Platform admins can manage all room availability" ON public.room_availability;
CREATE POLICY "Platform admins can manage all room availability" ON public.room_availability
    FOR ALL TO authenticated
    USING (public.is_platform_admin())
    WITH CHECK (public.is_platform_admin());

-- No public/anon policy at all yet — this table is not read by the
-- public booking flow in this migration (see header note). Add a
-- scoped public SELECT policy only when/if that integration happens.
