-- ============================================================
-- MIGRATION 059: round-trip transport must price as 2 legs
-- ============================================================
-- Bug (WOS-20260912-00062): a round_trip transport booking is a
-- pickup leg on one day and a *separate* return leg on another day
-- (see order item: รับ 2026-09-13, ส่งกลับ 2026-09-15). It was being
-- priced as a single one-way leg (quantity = 1) everywhere:
--
--   1. create_order_with_items(), Branch A ("let team decide" —
--      the only path transport actually takes, since the customer
--      never picks a partner up front) always persisted
--      order_items.quantity = 1 for transport, regardless of mode.
--   2. admin_assign_order_item() itself was fine (price =
--      unit_price * p_quantity for non-hotel) — the bug was entirely
--      in what quantity callers passed it:
--        - BookingsManager.tsx's reassignItem() hard-coded quantity=1
--          for "one_way / round_trip transport" as a single case.
--        - pending-assignments/page.tsx defaulted every item's
--          quantity input to '1', with no distinction for round_trip.
--
-- (2) is fixed in the TypeScript admin UI (BookingsManager.tsx,
-- pending-assignments/page.tsx) alongside this migration — those are
-- what actually price already-created orders and are the fix that
-- matters for money. This migration covers (1): the quantity value
-- order_items gets at booking time, before any admin has assigned a
-- package, so that a round_trip item's persisted quantity reads "2"
-- from the moment it's created rather than only once an admin fixes
-- it during assignment.
--
-- Only the "let team decide" branch (Branch A) is touched. Branch B
-- (resolved item, package_id already known) already honors whatever
-- quantity the client sends and is effectively unused for transport
-- today (transport has no partner picker — see BookingForm.tsx /
-- JourneyBookingForm.tsx comments, "transport is always let team
-- decide"), but is left as-is since it was never the source of the
-- bug.
--
-- Every other line of the function below is byte-for-byte identical
-- to the live definition from migration 058.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_order_with_items(
    p_patient_id UUID,
    p_items JSONB,
    p_notes TEXT DEFAULT NULL,
    p_attachment_url TEXT DEFAULT NULL,
    p_client_request_id UUID DEFAULT NULL
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
    v_transport_mode TEXT;
    v_quantity NUMERIC;
    v_room_quantity INTEGER;
    v_vehicle_type TEXT;
    v_passenger_count INTEGER;
    v_unit_price NUMERIC(12,2);
    v_price NUMERIC(12,2);
    v_deposit NUMERIC(12,2);
    v_is_unassigned BOOLEAN;
    v_existing RECORD;
    v_result JSONB;
BEGIN
    IF p_client_request_id IS NOT NULL THEN
        SELECT id, order_number, total_amount, total_deposit_required,
               currency, payment_access_token, patient_id
        INTO v_existing
        FROM public.orders
        WHERE client_request_id = p_client_request_id;

        IF FOUND THEN
            IF v_existing.patient_id <> p_patient_id THEN
                RAISE EXCEPTION 'client_request_id % already used by a different patient', p_client_request_id;
            END IF;

            RETURN jsonb_build_object(
                'order_id', v_existing.id,
                'order_number', v_existing.order_number,
                'total_amount', v_existing.total_amount,
                'total_deposit_required', v_existing.total_deposit_required,
                'currency', v_existing.currency,
                'payment_access_token', v_existing.payment_access_token,
                'idempotent_replay', true
            );
        END IF;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'order must have at least one item';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_patient_id) THEN
        RAISE EXCEPTION 'unknown patient_id %', p_patient_id;
    END IF;

    INSERT INTO public.orders (patient_id, status, notes, attachment_url, client_request_id)
    VALUES (p_patient_id, 'draft', p_notes, p_attachment_url, p_client_request_id)
    ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
    RETURNING id, order_number INTO v_order_id, v_order_number;

    IF NOT FOUND THEN
        SELECT id, order_number, total_amount, total_deposit_required,
               currency, payment_access_token, patient_id
        INTO v_existing
        FROM public.orders
        WHERE client_request_id = p_client_request_id;

        IF NOT FOUND OR v_existing.patient_id <> p_patient_id THEN
            RAISE EXCEPTION 'client_request_id % conflict could not be resolved to a matching order', p_client_request_id;
        END IF;

        RETURN jsonb_build_object(
            'order_id', v_existing.id,
            'order_number', v_existing.order_number,
            'total_amount', v_existing.total_amount,
            'total_deposit_required', v_existing.total_deposit_required,
            'currency', v_existing.currency,
            'payment_access_token', v_existing.payment_access_token,
            'idempotent_replay', true
        );
    END IF;

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

            v_vehicle_type := NULLIF(v_item->>'vehicle_type', '');
            v_passenger_count := NULLIF(v_item->>'passenger_count', '')::INTEGER;
            IF v_service_type <> 'transport' AND
               (v_vehicle_type IS NOT NULL OR v_passenger_count IS NOT NULL) THEN
                RAISE EXCEPTION 'vehicle_type/passenger_count are only supported for transport items (got service_type=%)', v_service_type;
            END IF;
            IF v_passenger_count IS NOT NULL AND v_passenger_count <= 0 THEN
                RAISE EXCEPTION 'passenger_count must be positive';
            END IF;

            -- Fix (058): for hotel items where the customer already
            -- picked dates (just not a specific package/partner),
            -- nights are known at booking time — compute and persist
            -- it now instead of leaving it at the column default of 1.
            --
            -- Fix (059): round_trip transport is two one-way legs on
            -- two separate days (pickup + a separate return day),
            -- each billed at the one-way unit rate, so it persists as
            -- quantity 2 from the moment it's created — not just once
            -- an admin fixes it during assignment. one_way and
            -- medical_assistance transport, and transport/hotel with
            -- no dates yet, stay at 1 until an admin assigns.
            IF v_service_type = 'hotel'
               AND v_item->>'scheduled_date' IS NOT NULL
               AND v_item->>'hotel_checkout_date' IS NOT NULL
            THEN
                v_quantity := (
                    NULLIF(v_item->>'hotel_checkout_date', '')::DATE
                    -
                    NULLIF(v_item->>'scheduled_date', '')::DATE
                );
                IF v_quantity IS NULL OR v_quantity <= 0 THEN
                    RAISE EXCEPTION 'hotel_checkout_date must be after scheduled_date';
                END IF;
            ELSIF v_service_type = 'transport' THEN
                v_transport_mode := NULLIF(v_item->>'transport_mode', '');
                v_quantity := CASE WHEN v_transport_mode = 'round_trip' THEN 2 ELSE 1 END;
            ELSE
                v_quantity := 1;
            END IF;

            INSERT INTO public.order_items (
                order_id, partner_id, package_id, service_type,
                price, deposit_required, scheduled_date, scheduled_time,
                deposit_rule_id, needs_assignment,
                hotel_checkout_date, transport_mode,
                transport_return_date, transport_return_time,
                pickup_location, dropoff_location,
                room_quantity, vehicle_type, passenger_count,
                quantity
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
                v_room_quantity, v_vehicle_type, v_passenger_count,
                v_quantity
            );

            CONTINUE;
        END IF;

        -- ----------------------------------------------------
        -- Branch B: resolved item — same price/partner/service_type
        -- derivation as migration 012/014/025/028/037/057/058.
        -- ----------------------------------------------------
        SELECT * INTO v_pkg FROM public.packages
        WHERE id = (v_item->>'package_id')::UUID
          AND status = 'published'
          AND is_active = true;

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

        v_vehicle_type := NULLIF(v_item->>'vehicle_type', '');
        v_passenger_count := NULLIF(v_item->>'passenger_count', '')::INTEGER;
        IF v_service_type <> 'transport' AND
           (v_vehicle_type IS NOT NULL OR v_passenger_count IS NOT NULL) THEN
            RAISE EXCEPTION 'vehicle_type/passenger_count are only supported for transport items (got service_type=% for package %)', v_service_type, v_pkg.id;
        END IF;
        IF v_passenger_count IS NOT NULL AND v_passenger_count <= 0 THEN
            RAISE EXCEPTION 'passenger_count must be positive for package %', v_pkg.id;
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
            room_quantity, vehicle_type, passenger_count,
            quantity
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
            v_room_quantity, v_vehicle_type, v_passenger_count,
            v_quantity
        );
    END LOOP;

    UPDATE public.orders SET status = 'pending_deposit' WHERE id = v_order_id;

    SELECT jsonb_build_object(
        'order_id', o.id,
        'order_number', o.order_number,
        'total_amount', o.total_amount,
        'total_deposit_required', o.total_deposit_required,
        'currency', o.currency,
        'payment_access_token', o.payment_access_token,
        'idempotent_replay', false
    )
    INTO v_result
    FROM public.orders o
    WHERE o.id = v_order_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT, TEXT, UUID)
  TO service_role;
