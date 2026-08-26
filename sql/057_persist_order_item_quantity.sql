-- ============================================================
-- MIGRATION 057: order_items.quantity — persist the nights/days
-- figure that create_order_with_items() and admin_assign_order_item()
-- have only ever used transiently to compute price, then discarded.
--
-- Gap this closes: v_quantity (Branch B of create_order_with_items(),
-- migrations 012/014/025/028/036/037) and p_quantity
-- (admin_assign_order_item(), migrations 016 through 056) are both
-- local PL/pgSQL variables — neither was ever written to a column.
-- For hotel items the nights figure is *usually* recoverable after
-- the fact from scheduled_date/hotel_checkout_date (see
-- BookingsManager.tsx's calcNights()), but for transport 'daily'
-- mode there is no date pair that represents day-count at all — the
-- customer enters a raw number (BookingForm.tsx's transportDays) and
-- it was never stored anywhere once folded into price. An admin
-- reassigning a daily-transport item today has no way to know how
-- many days the customer actually paid for; the previous workaround
-- (BookingsManager.tsx prompting the admin to re-enter it by hand)
-- is a data-loss workaround, not a fix.
--
-- Fix: persist quantity going forward as its own column.
--   - Branch A (unassigned "let team decide"): stays at the column
--     default of 1 — genuinely not known until an admin assigns.
--   - Branch B (resolved at booking time): v_quantity is now written
--     alongside price/room_quantity.
--   - admin_assign_order_item(): p_quantity is now written back onto
--     the row on every successful assignment/reassignment — this
--     makes the column self-correcting the moment an admin picks a
--     real value, even for rows created before this migration ran.
--
-- Does NOT change how price is computed anywhere — same
-- unit_price × quantity × room_quantity (hotel) / unit_price ×
-- quantity (else) as today. This migration only stops throwing the
-- number away after using it.
--
-- Every line of admin_assign_order_item() below is byte-for-byte
-- identical to the live definition in migration 056, except the
-- final UPDATE now also writes `quantity`.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS quantity NUMERIC NOT NULL DEFAULT 1;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS chk_order_items_quantity_positive;
ALTER TABLE public.order_items
  ADD CONSTRAINT chk_order_items_quantity_positive CHECK (quantity > 0);

COMMENT ON COLUMN public.order_items.quantity IS
  'Nights (hotel) / days (transport "daily" mode) / 1 (everything else, including one_way/round_trip transport and unassigned rows awaiting admin assignment). Multiplies into price alongside room_quantity for hotel items: price = unit_price × quantity × room_quantity. Set at booking time by create_order_with_items() when a package is resolved directly, or by admin_assign_order_item() when an admin resolves a "let team decide" row or reassigns an existing one — see migration 057.';

-- ------------------------------------------------------------
-- create_order_with_items() — persist v_quantity in Branch B.
-- Every line below is byte-for-byte identical to the live
-- definition in migration 037, except the two INSERT statements
-- (Branch A and Branch B) now include `quantity` in their column
-- list, and Branch B's VALUES now includes v_quantity (Branch A
-- has no v_quantity yet — the row keeps the column default of 1
-- until admin_assign_order_item() sets a real one).
-- ------------------------------------------------------------
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

            INSERT INTO public.order_items (
                order_id, partner_id, package_id, service_type,
                price, deposit_required, scheduled_date, scheduled_time,
                deposit_rule_id, needs_assignment,
                hotel_checkout_date, transport_mode,
                transport_return_date, transport_return_time,
                pickup_location, dropoff_location,
                room_quantity, vehicle_type, passenger_count
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
                v_room_quantity, v_vehicle_type, v_passenger_count
                -- quantity: not set here — stays at the column default
                -- of 1 until admin_assign_order_item() sets a real
                -- value at assignment time (migration 057).
            );

            CONTINUE;
        END IF;

        -- ----------------------------------------------------
        -- Branch B: resolved item — same price/partner/service_type
        -- derivation as migration 012/014/025/028/037.
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

-- ------------------------------------------------------------
-- admin_assign_order_item() — persist p_quantity onto the row.
-- Every line below is byte-for-byte identical to the live
-- definition in migration 056, except the final UPDATE now also
-- sets `quantity = p_quantity`, and the returned JSONB now includes
-- it (parity with room_quantity, already returned since migration
-- 040).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_assign_order_item(
    p_order_item_id UUID,
    p_package_id UUID,
    p_quantity NUMERIC DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row RECORD;
    v_order_status TEXT;
    v_pkg RECORD;
    v_partner RECORD;
    v_rule RECORD;
    v_service_type TEXT;
    v_unit_price NUMERIC(12,2);
    v_price NUMERIC(12,2);
    v_deposit NUMERIC(12,2);
    v_is_reassignment BOOLEAN;
BEGIN
    SELECT * INTO v_row FROM public.order_items WHERE id = p_order_item_id;
    IF v_row IS NULL THEN
        RAISE EXCEPTION 'order_item % not found', p_order_item_id;
    END IF;

    v_is_reassignment := (v_row.needs_assignment IS NOT TRUE);

    IF v_is_reassignment THEN
        IF v_row.service_type NOT IN ('hotel', 'transport') THEN
            RAISE EXCEPTION
                'order_item % is already assigned and reassignment via this path is only supported for hotel/transport items (got service_type=%)',
                p_order_item_id, v_row.service_type;
        END IF;

        SELECT status INTO v_order_status FROM public.orders WHERE id = v_row.order_id;

        IF v_order_status IS DISTINCT FROM 'draft'
           AND v_order_status IS DISTINCT FROM 'pending_deposit'
           AND v_order_status IS DISTINCT FROM 'pending_verification'
           AND v_order_status IS DISTINCT FROM 'deposit_paid' THEN
            RAISE EXCEPTION
                'cannot reassign order_item %: parent order status is % — package is locked once confirmed, cancel/refund instead',
                p_order_item_id, v_order_status;
        END IF;
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'quantity must be positive';
    END IF;

    SELECT * INTO v_pkg FROM public.packages
    WHERE id = p_package_id
      AND status = 'published'
      AND is_active = true;
    IF v_pkg IS NULL THEN
        RAISE EXCEPTION 'unknown, unpublished, or inactive package_id %', p_package_id;
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

    IF v_service_type IS DISTINCT FROM v_row.service_type THEN
        RAISE EXCEPTION 'category mismatch: order_item is % but package resolves to %',
            v_row.service_type, v_service_type;
    END IF;

    v_unit_price := COALESCE(v_pkg.special_price, v_pkg.original_price);

    IF v_service_type = 'hotel' THEN
        v_price := ROUND(
            v_unit_price
            * p_quantity
            * COALESCE(v_row.room_quantity, 1),
            2
        );
    ELSE
        v_price := ROUND(
            v_unit_price * p_quantity,
            2
        );
    END IF;

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

    UPDATE public.order_items SET
        package_id = v_pkg.id,
        partner_id = v_partner.id,
        price = v_price,
        deposit_required = v_deposit,
        deposit_rule_id = v_rule.id,
        balance_remaining = v_price - COALESCE(deposit_paid, 0),
        needs_assignment = false,
        quantity = p_quantity
    WHERE id = p_order_item_id;

    RETURN jsonb_build_object(
        'order_item_id', p_order_item_id,
        'package_id', v_pkg.id,
        'partner_id', v_partner.id,
        'price', v_price,
        'deposit_required', v_deposit,
        'was_reassignment', v_is_reassignment,
        'room_quantity', COALESCE(v_row.room_quantity, 1),
        'quantity', p_quantity
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) TO service_role;
