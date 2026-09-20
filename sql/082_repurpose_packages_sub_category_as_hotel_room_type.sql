-- ============================================================
-- 082_repurpose_packages_sub_category_as_hotel_room_type.sql
--
-- CONTEXT: public.packages.sub_category (added in 001) has never
-- been read or written by any app code — confirmed via full repo
-- grep. This migration doesn't touch the column at all; it's here
-- purely to document a new meaning the app is about to give it, so
-- a future reader of \d+ packages or this migration folder isn't
-- confused about why an "unused" column suddenly has data.
--
-- DECISION: repurpose sub_category as the hotel room-type field
-- (single/double/twin/deluxe/suite/other) instead of adding a new
-- room_type column. Same free-text-column + UI-enforced-dropdown
-- pattern already used for transport vehicleType (037) and
-- pickup/dropoff LocationType in BookingForm.tsx/JourneyBookingForm.tsx
-- — no CHECK constraint, because partner-typed values shouldn't hard-
-- fail an insert, but the UI dropdown is the source of truth for the
-- 5 standard values. Only populated for partners.category = 'Hotel'
-- rows; NULL/free-text for every other category, same as before.
--
-- Not used as a filter on non-hotel categories today, but the column
-- stays generically named (not "room_type") in case another category
-- eventually needs its own sub-classification — this migration only
-- claims the Hotel-category usage of it.
--
-- UPDATE (2026-09-08): the "no ALTER TABLE needed" assumption below
-- was based on 001_schema_and_rls.sql, which does NOT reflect the
-- live table. public.packages was dropped and rebuilt with a
-- different shape (partner_id-based, no organization_id — see
-- migration 010's audit notes) during an undocumented hotfix
-- ("004_fix_packages_collision.sql") that was run directly in the
-- Supabase SQL editor and never saved to this repo. That rebuild
-- did not carry sub_category over. Confirmed live via:
--   ERROR: 42703: column "sub_category" of relation "public.packages"
--   does not exist
-- So this migration now actually adds the column before commenting
-- on it. IF NOT EXISTS keeps it idempotent/safe to re-run.
-- ============================================================

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS sub_category TEXT;

COMMENT ON COLUMN public.packages.sub_category IS
  'Free-text sub-classification, scoped per partners.category. For category=Hotel: room type selected from a fixed UI dropdown (single/double/twin/deluxe/suite/other) in partner + admin PackagesManager.tsx, used to filter the hotel step in BookingForm.tsx/JourneyBookingForm.tsx. No DB-level constraint — see migration comment for rationale.';
