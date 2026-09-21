-- ============================================================
-- 119_transport_partner_vehicles.sql
--
-- CONTEXT: WOS Partner Inventory Portal — Transportation & Hotel
-- Pilot brief, Phase 4 (Transport Group, Milestone 2 — see brief
-- section "กลุ่มที่ 2 — รถ"). First Transport-side migration; Hotel
-- side (Phase 1-3, migration 118) is already shipped and tested.
--
-- Phase 4 — `vehicles`: a genuinely new table, the Transport
-- equivalent of what `packages` + migration 118 did for Hotel rooms.
-- Today there is NO partner-owned fleet data at all: vehicle_type on
-- an order_item (migration 037) and transport_vehicle_pricing
-- (migration 081) are both just a shared 5-value list
-- (sedan/suv/vip_van/medical_transport/other) used for a customer-
-- facing price *hint* — neither one is scoped to a partner, and
-- neither represents an actual vehicle a partner owns. This table is
-- that: "which vehicles does this Transport partner actually have,
-- and how many of each."
--
-- vehicle_type here is intentionally a plain TEXT column (not a FK,
-- no CHECK/enum), reusing the exact same 5 values as
-- transport_vehicle_pricing.vehicle_type / order_items.vehicle_type
-- (migration 037/081) — VehicleType in BookingForm.tsx/
-- JourneyBookingForm.tsx remains the one source of truth for which
-- values are valid; VEHICLE_TYPE_OPTIONS in VehiclesManager.tsx
-- mirrors it for the partner-facing dropdown, same
-- free-text-UI-enforced pattern as packages.sub_category (082) and
-- packages.amenities (118).
--
-- Deliberately NOT wired into any booking/assignment flow yet — see
-- brief Phase 7 (vehicle_availability, date-based capacity) and
-- Phase 9 (job queue / driver assignment) for that follow-up work.
-- This migration is Phase 4 only: partner fleet inventory as a
-- reference list, read/write for the partner (and read for admin),
-- not yet checked or decremented anywhere at booking/assignment
-- time — same staged-rollout shape as room_availability (118).
--
-- Idempotent (IF NOT EXISTS / DROP+CREATE POLICY throughout), same
-- pattern as 045/046/047/074/081/118. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,

    -- Same 5-value list as transport_vehicle_pricing.vehicle_type /
    -- order_items.vehicle_type (migration 037/081) — see header note.
    vehicle_type TEXT NOT NULL,

    -- Partner's own label for this vehicle/fleet line, e.g. "Toyota
    -- Alphard คันที่ 1" or "รถเก๋ง Camry (ทะเบียน กข 1234)" — free
    -- text, not customer-facing (customers only ever see vehicle_type).
    name TEXT NOT NULL,

    plate TEXT,
    seats INTEGER,

    -- How many identical vehicles of this type/config the partner has
    -- under this one fleet line — same "one row, a quantity column"
    -- shape as packages.room_quantity (migration 028), not one row
    -- per physical vehicle. A partner with 3 identical Alphards can
    -- use a single row with quantity=3 rather than 3 near-duplicate
    -- rows; a partner who wants to track them individually can still
    -- use quantity=1 per row and give each its own plate/name.
    quantity INTEGER NOT NULL DEFAULT 1,

    -- Partner-controlled on/off switch, same is_active pattern as
    -- packages.is_active — lets a partner temporarily hide a vehicle
    -- (in the shop for repair, driver on leave, etc.) without
    -- deleting the row and losing its history.
    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_vehicles_seats_positive CHECK (seats IS NULL OR seats > 0),
    CONSTRAINT chk_vehicles_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_partner_id ON public.vehicles(partner_id);

DROP TRIGGER IF EXISTS set_updated_at_vehicles ON public.vehicles;
CREATE TRIGGER set_updated_at_vehicles
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Guard: only meaningful for Transport-category partners today (same
-- "reject at the DB layer, don't just hide it in the UI" instinct as
-- migration 118's room_availability hotel-only guard, mirrored here
-- for the Transport side). If a Hotel or Clinic partner_id somehow
-- reaches this table (bug, admin mistake, future code path), reject
-- it loudly instead of silently storing an orphaned fleet row.
CREATE OR REPLACE FUNCTION public.check_vehicles_transport_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_category TEXT;
BEGIN
  SELECT p.category INTO v_category
  FROM public.partners p
  WHERE p.id = NEW.partner_id;

  IF v_category IS DISTINCT FROM 'Transport' THEN
    RAISE EXCEPTION 'vehicles.partner_id % belongs to a non-Transport partner (category=%) — this table is Transport-only for now', NEW.partner_id, v_category;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_transport_only ON public.vehicles;
CREATE TRIGGER vehicles_transport_only
  BEFORE INSERT OR UPDATE OF partner_id ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.check_vehicles_transport_only();

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- Same ownership check shape as "Partners can manage their own
-- packages" (migration 041) — vehicles.partner_id is direct (no
-- packages join needed, unlike room_availability in 118 which has to
-- go through packages.partner_id).
DROP POLICY IF EXISTS "Partners can manage their own vehicles" ON public.vehicles;
CREATE POLICY "Partners can manage their own vehicles" ON public.vehicles
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

-- Platform admins: read/write everything, reusing the same
-- is_platform_admin() helper as every other admin-all policy (053,
-- 118, ...) rather than re-deriving the admin check by hand here.
DROP POLICY IF EXISTS "Platform admins can manage all vehicles" ON public.vehicles;
CREATE POLICY "Platform admins can manage all vehicles" ON public.vehicles
    FOR ALL TO authenticated
    USING (public.is_platform_admin())
    WITH CHECK (public.is_platform_admin());

-- No public/anon policy at all yet — this table is not read by the
-- public booking flow in this migration (see header note). Add a
-- scoped public SELECT policy only when/if that integration happens.
