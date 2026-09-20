-- ============================================================
-- MIGRATION 081: transport_vehicle_pricing
--
-- Context: the Transport booking step (BookingForm.tsx /
-- JourneyBookingForm.tsx) used to end with a Partner-package
-- dropdown ("let team decide" vs pick a specific transport
-- partner), same shape as the Hotel step's dropdown. Decision this
-- round: remove it for Transport specifically.
--
--   - Hotel scales to many partners fine — it already filters by
--     province first, then groups by hotel via optgroup, and shows
--     a real price per option. Transport had none of that: a flat
--     list, no grouping, no price shown — it would have been the
--     first thing to break as more transport partners are added.
--   - vehicleType (sedan/suv/vip_van/medical_transport) is already
--     asked earlier in the same step and functions as a de facto
--     price tier. Asking for a specific transport company on top of
--     that added a second decision that gave the customer almost no
--     information (cross-border customers from Laos generally don't
--     recognize Thai transport company names) while adding real
--     maintenance cost as more partners onboard.
--   - Transport keeps the existing "let team decide" -> admin
--     assign -> /quote/[orderNumber] flow (unchanged, no schema
--     impact there) — an order_item's actual partner/price is still
--     resolved by staff after booking, same as before. This
--     migration only adds a small, admin-editable "starting from"
--     price hint shown next to each vehicleType in the UI, so the
--     customer isn't picking blind.
--
-- Deliberately NOT a per-partner pricing matrix (that would need a
-- real prices-by-partner-by-vehicle-type schema, a bigger, separate
-- piece of work) — just one starting price per vehicle_type, shown
-- as a hint only. Never used to compute order totals; see
-- priceBreakdown in BookingForm.tsx / JourneyBookingForm.tsx, which
-- deliberately excludes transport from `total` for this reason.
--
-- vehicle_type here is intentionally a plain TEXT primary key (not a
-- FK to anything — order_items.vehicle_type is free text too, per
-- migration 037) rather than a DB enum, so admin can add a new
-- vehicle type row without a schema change; the UI dropdown in
-- BookingForm.tsx/JourneyBookingForm.tsx remains the source of truth
-- for which values are actually offered to customers.
--
-- Idempotent (IF NOT EXISTS / DROP+CREATE POLICY throughout),
-- matching the pattern used in 045/046/047/074. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transport_vehicle_pricing (
    vehicle_type TEXT PRIMARY KEY,
    starting_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'THB',
    -- Lets admin hide a vehicle type's price hint (show nothing in
    -- the UI) without deleting the row or losing the price value —
    -- same is_active pattern as packages.is_active (migration
    -- migration_add_package_is_active.sql).
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_transport_vehicle_pricing ON public.transport_vehicle_pricing;
CREATE TRIGGER set_updated_at_transport_vehicle_pricing
    BEFORE UPDATE ON public.transport_vehicle_pricing
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Seed the 4 vehicle types the UI currently offers (see VehicleType
-- in BookingForm.tsx — 'other' is free-text and deliberately has no
-- pricing row / no hint shown). Prices seeded at 0 as a placeholder:
-- 0 is treated as "no hint" by fetchTransportVehiclePricing() /
-- transportStartingPrice in the UI, so this ships safely with no
-- price hints shown until real starting prices are filled in
-- (no admin UI for this table yet — set directly via Supabase table
-- editor / SQL for now).
INSERT INTO public.transport_vehicle_pricing (vehicle_type, starting_price)
VALUES
    ('sedan', 0),
    ('suv', 0),
    ('vip_van', 0),
    ('medical_transport', 0)
ON CONFLICT (vehicle_type) DO NOTHING;

ALTER TABLE public.transport_vehicle_pricing ENABLE ROW LEVEL SECURITY;

-- Public (anon) read of active rows only — this is what
-- fetchTransportVehiclePricing() in lib/data.ts queries with the
-- anon client for the booking pages. No public write policy: admin
-- edits go through the service-role client (same pattern as the
-- taxonomy tables in migration 074 — no admin UI/route built yet for
-- this table, so writes are SQL/table-editor only for now).
DROP POLICY IF EXISTS "Public can read active transport vehicle pricing" ON public.transport_vehicle_pricing;
CREATE POLICY "Public can read active transport vehicle pricing" ON public.transport_vehicle_pricing
    FOR SELECT TO anon, authenticated USING (is_active = true);
