-- ============================================================
-- MIGRATION 028: multi-room hotel bookings — order_items.room_quantity
--
-- Customer can now request N rooms for the same hotel stay from
-- BookingForm.tsx / JourneyBookingForm.tsx, instead of always 1.
-- Existing `quantity` on a hotel item already means NIGHTS (see
-- migration 012/014 — customer sends quantity = calcNights(checkin,
-- checkout)). room_quantity is a SEPARATE multiplier:
--
--   hotel item price = unit_price × nights × room_quantity
--
-- Scope: hotel items only. A main-package or transport item with
-- room_quantity != 1 is rejected server-side — same "never trust
-- the client for anything that touches price" rule as everything
-- else create_order_with_items() derives.
--
-- Touches BOTH insert branches in create_order_with_items()
-- (resolved package_id item, and "let team decide" service_type
-- item), same as migration 025 did for pickup_location/
-- dropoff_location — either shape can be a hotel item.
--
-- Also re-closes the anon/authenticated EXECUTE hole (migration 027)
-- on create_order_with_items(): CREATE OR REPLACE FUNCTION does NOT
-- preserve previously-revoked grants — Supabase's default privilege
-- rule re-grants EXECUTE to anon/authenticated at CREATE FUNCTION
-- time regardless of what a prior migration revoked. Every migration
-- that touches this function must re-run the anon/authenticated
-- revoke, or it silently reopens migration 027's hole.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS room_quantity INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS chk_order_items_room_quantity_positive;
ALTER TABLE public.order_items
  ADD CONSTRAINT chk_order_items_room_quantity_positive CHECK (room_quantity > 0);

COMMENT ON COLUMN public.order_items.room_quantity IS
  'Number of rooms booked for a hotel item (default 1). Multiplies into price alongside nights (quantity): price = unit_price × nights × room_quantity. Always 1 for non-hotel items — enforced in create_order_with_items(). Set from BookingForm.tsx / JourneyBookingForm.tsx room-quantity selector.';

-- ------------------------------------------------------------
-- create_order_with_items() update
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_with_items(
    p_patient_id UUID,
    p_items JSONB,
    p_notes TEXT DEFAULT NULL,
    p_attachment_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id UUID;
    v_order_number TEXT;
    v_item JSONB;
    v_pkg RECORD;
    v_partner RECORD;
    v_rule RECORD;
    v_service_type TEXT;
    v_quantity NUMERIC;
    v_room_quantity INTEGER;
    v_unit_price NUMERIC(12,2);
    v_price NUMERIC(12,2);
    v_deposit NUMERIC(12,2);
    v_is_unassigned BOOLEAN;
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'order must have at least one item';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_patient_id) THEN
        RAISE EXCEPTION 'unknown patient_id %', p_patient_id;
    END IF;

    INSERT INTO public.orders (patient_id, status, notes, attachment_url)
    VALUES (p_patient_id, 'draft', p_notes, p_attachment_url)
    RETURNING id, order_number INTO v_order_id, v_order_number;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_is_unassigned := NOT (v_item ? 'package_id');

        -- ----------------------------------------------------
        -- Branch A: "let team decide" — no package chosen yet.
        -- ----------------------------------------------------
        IF v_is_unassigned THEN
            IF NOT (v_item ? 'service_type') THEN
                RAISE EXCEPTION 'item without package_id requires service_type';
            END IF;

            v_service_type := v_item->>'service_type';
            IF v_service_type NOT IN ('hotel', 'transport') THEN
                RAISE EXCEPTION '"let team decide" is only supported for hotel/transport, got %', v_service_type;
            END IF;

            v_room_quantity := COALESCE((v_item->>'room_quantity')::INTEGER, 1);
            IF v_room_quantity <= 0 THEN
                RAISE EXCEPTION 'room_quantity must be positive';
            END IF;
            IF v_service_type <> 'hotel' AND v_room_quantity <> 1 THEN
                RAISE EXCEPTION 'room_quantity is only supported for hotel items (got service_type=%)', v_service_type;
            END IF;

            INSERT INTO public.order_items (
                order_id, partner_id, package_id, service_type,
                price, deposit_required, scheduled_date, scheduled_time,
                deposit_rule_id, needs_assignment,
                hotel_checkout_date, transport_mode,
                transport_return_date, transport_return_time,
                pickup_location, dropoff_location,
                room_quantity
            ) VALUES (
                v_order_id,
                NULL, NULL, v_service_type,
                NULL, NULL,
                NULLIF(v_item->>'scheduled_date', '')::DATE,
                NULLIF(v_item->>'scheduled_time', '')::TIME,
                NULL, true,
                NULLIF(v_item->>'hotel_checkout_date', '')::DATE,
                NULLIF(v_item->>'transport_mode', ''),
                NULLIF(v_item->>'transport_return_date', '')::DATE,
                NULLIF(v_item->>'transport_return_time', '')::TIME,
                NULLIF(v_item->>'transport_pickup_location', ''),
                NULLIF(v_item->>'transport_dropoff_location', ''),
                v_room_quantity
            );

            CONTINUE;
        END IF;

        -- ----------------------------------------------------
        -- Branch B: resolved item — same price/partner/service_type
        -- derivation as migration 012/014/025, plus room_quantity.
        -- ----------------------------------------------------
        SELECT * INTO v_pkg FROM public.packages
        WHERE id = (v_item->>'package_id')::UUID AND status = 'published';

        IF v_pkg IS NULL THEN
            RAISE EXCEPTION 'unknown or unpublished package_id %', v_item->>'package_id';
        END IF;

        SELECT * INTO v_partner FROM public.partners WHERE id = v_pkg.partner_id;
        IF v_partner IS NULL THEN
            RAISE EXCEPTION 'package % has no valid partner', v_pkg.id;
        END IF;

        v_service_type := CASE v_partner.category
            WHEN 'Hospital'  THEN 'clinic'
            WHEN 'Clinic'    THEN 'clinic'
            WHEN 'Dental'    THEN 'clinic'
            WHEN 'Wellness'  THEN 'wellness'
            WHEN 'Spa'       THEN 'wellness'
            WHEN 'Hotel'     THEN 'hotel'
            WHEN 'Transport' THEN 'transport'
            ELSE NULL
        END;

        IF v_service_type IS NULL THEN
            RAISE EXCEPTION 'partner category % has no service_type mapping', v_partner.category;
        END IF;

        v_quantity := COALESCE((v_item->>'quantity')::NUMERIC, 1);
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'quantity must be positive for package %', v_pkg.id;
        END IF;

        v_room_quantity := COALESCE((v_item->>'room_quantity')::INTEGER, 1);
        IF v_room_quantity <= 0 THEN
            RAISE EXCEPTION 'room_quantity must be positive for package %', v_pkg.id;
        END IF;
        IF v_service_type <> 'hotel' AND v_room_quantity <> 1 THEN
            RAISE EXCEPTION 'room_quantity is only supported for hotel items (got service_type=% for package %)', v_service_type, v_pkg.id;
        END IF;

        v_unit_price := COALESCE(v_pkg.special_price, v_pkg.original_price);
        v_price := ROUND(v_unit_price * v_quantity * v_room_quantity, 2);

        SELECT * INTO v_rule
        FROM public.deposit_rules
        WHERE service_type = v_service_type
          AND active = true
          AND (partner_id = v_partner.id OR partner_id IS NULL)
        ORDER BY (partner_id = v_partner.id) DESC, priority DESC
        LIMIT 1;

        IF v_rule IS NULL THEN
            RAISE EXCEPTION 'no active deposit_rule for service_type=%', v_service_type;
        END IF;

        v_deposit := CASE v_rule.deposit_type
            WHEN 'percentage' THEN ROUND(v_price * v_rule.deposit_value / 100, 2)
            WHEN 'fixed'      THEN v_rule.deposit_value
            ELSE 0
        END;

        INSERT INTO public.order_items (
            order_id, partner_id, package_id, service_type,
            price, deposit_required, scheduled_date, scheduled_time,
            deposit_rule_id, needs_assignment,
            hotel_checkout_date, transport_mode,
            transport_return_date, transport_return_time,
            pickup_location, dropoff_location,
            room_quantity
        ) VALUES (
            v_order_id,
            v_partner.id,
            v_pkg.id,
            v_service_type,
            v_price,
            v_deposit,
            NULLIF(v_item->>'scheduled_date', '')::DATE,
            NULLIF(v_item->>'scheduled_time', '')::TIME,
            v_rule.id,
            false,
            NULLIF(v_item->>'hotel_checkout_date', '')::DATE,
            NULLIF(v_item->>'transport_mode', ''),
            NULLIF(v_item->>'transport_return_date', '')::DATE,
            NULLIF(v_item->>'transport_return_time', '')::TIME,
            NULLIF(v_item->>'transport_pickup_location', ''),
            NULLIF(v_item->>'transport_dropoff_location', ''),
            v_room_quantity
        );
    END LOOP;

    UPDATE public.orders SET status = 'pending_deposit' WHERE id = v_order_id;

    RETURN jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number);
END;
$$;

-- Signature unchanged from migration 014/025 — but see header note:
-- CREATE OR REPLACE does not preserve prior REVOKEs, so re-assert
-- the full migration-027 lockdown (anon/authenticated included, not
-- just PUBLIC) here too.
REVOKE ALL ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT, TEXT)
  TO service_role;

-- ------------------------------------------------------------
-- NOT handled by this migration — see admin_assign_order_item()
-- (migration 016, not in this repo's SQL folder). That function
-- takes p_quantity directly from the admin's Next.js request and
-- has no room_quantity parameter of its own; when an admin resolves
-- a "let team decide" hotel item, room_quantity already sits on the
-- order_items row from Branch A above. The fix lives in
-- api/admin/order-items/[id]/assign/route.ts instead: fetch
-- room_quantity from the row server-side and fold it into the
-- p_quantity sent to the RPC, rather than changing the RPC's
-- signature. See that file's updated comment for the full reasoning.
-- ------------------------------------------------------------
