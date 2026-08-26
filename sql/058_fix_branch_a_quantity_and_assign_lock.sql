-- ============================================================
-- MIGRATION 058: fix two issues found in review of 057
-- (057 already ran in production — this migration only
-- redefines the two functions, it does not touch the
-- order_items.quantity column/constraint/comment again).
--
-- Issue 1 — create_order_with_items(), Branch A ("let team
-- decide"): quantity was always left at the column default of 1,
-- even when the customer already picked scheduled_date and
-- hotel_checkout_date for a hotel item. Nights are knowable at
-- booking time in that case (only package/partner are still
-- unresolved) — compute and persist v_quantity now instead.
-- Everything else (no dates yet, or transport "let team decide")
-- still defaults to 1 until an admin assigns.
--
-- Issue 2 — admin_assign_order_item(): the initial
-- SELECT ... INTO v_row had no lock, so two admins assigning the
-- same item concurrently could both read stale state and one
-- UPDATE would clobber the other's. Added FOR UPDATE.
--
-- Every other line of both functions below is byte-for-byte
-- identical to the live definitions from migration 057.
--
-- Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- create_order_with_items()
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

            -- Fix (058): for hotel items where the customer already
            -- picked dates (just not a specific package/partner),
            -- nights are known at booking time — compute and persist
            -- it now instead of leaving it at the column default of 1.
            -- Everything else (no dates yet, or transport "let team
            -- decide") stays at 1 until admin_assign_order_item()
            -- sets a real value.
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
        -- derivation as migration 012/014/025/028/037/057.
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
-- admin_assign_order_item() — add FOR UPDATE to the initial SELECT.
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
    -- Fix (058): FOR UPDATE locks the row for the duration of this
    -- transaction so two admins assigning the same item concurrently
    -- serialize instead of both reading stale state and one UPDATE
    -- clobbering the other's.
    SELECT * INTO v_row FROM public.order_items WHERE id = p_order_item_id FOR UPDATE;
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
