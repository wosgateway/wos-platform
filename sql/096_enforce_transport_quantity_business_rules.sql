-- ============================================================
-- MIGRATION 096: DB-enforced transport quantity business rules
-- (Branch A + Branch B) in create_order_with_items()
-- ============================================================
-- Follow-up to migration 059 (WOS-20260912-00062), which fixed
-- round_trip quantity in Branch A ("let team decide") only. Two gaps
-- remained, both in create_order_with_items():
--
--   1. Branch B (client already sent a resolved package_id) still
--      trusted the client's raw `quantity` for every transport_mode,
--      including round_trip:
--
--          v_quantity := COALESCE((v_item->>'quantity')::NUMERIC, 1);
--
--      So a client that sent transport_mode='round_trip' with
--      quantity=1 got exactly that persisted — and the price
--      calculation right after,
--
--          v_price := ROUND(v_unit_price * v_quantity * v_room_quantity, 2);
--
--      then under-priced the booking by a full leg. Branch B was left
--      alone in 059 because transport has no partner picker in the
--      UI today (see BookingForm.tsx / JourneyBookingForm.tsx — every
--      transport item goes through Branch A as "let team decide"), so
--      it was "effectively unused." It is still reachable by any
--      direct caller of the RPC with a Transport-category package_id,
--      so it needs the same guarantee Branch A now has.
--
--   2. Branch A itself only special-cased round_trip
--      (`CASE WHEN v_transport_mode = 'round_trip' THEN 2 ELSE 1 END`).
--      'daily' transport — priced per day actually booked — fell into
--      the ELSE and was silently forced to quantity 1 regardless of
--      how many days the customer selected
--      (JourneyBookingForm.tsx sends `quantity: form.transportDays`
--      for daily, which Branch A discarded entirely).
--
-- Business rule (all four transport_mode values), enforced in BOTH
-- branches from here on:
--
--   round_trip           -> quantity ALWAYS 2 (pickup leg + a separate
--                            return-day leg), regardless of what a
--                            caller sends.
--   one_way               -> quantity ALWAYS 1.
--   medical_assistance    -> quantity ALWAYS 1.
--   daily                 -> quantity = number of days actually
--                            booked. There is no date-range column for
--                            daily transport yet (unlike hotel's
--                            scheduled_date/hotel_checkout_date pair,
--                            fixed in 058), so this is the one mode
--                            the DB cannot independently derive — the
--                            client-supplied day count is trusted but
--                            must be a positive number. If daily
--                            transport needs the same hard DB
--                            guarantee round_trip now has, a follow-up
--                            migration should add a
--                            transport_return_date-style column for it
--                            and compute quantity from that instead;
--                            flagging this for the team rather than
--                            silently pretending it's fully closed.
--
-- Branch A vs Branch B differ on one thing: what happens when
-- transport_mode is missing/NULL.
--   - Branch A can still legitimately not know the mode yet (a draft
--     "let team decide" item with no dates chosen) — falls back to 1,
--     same as before 059/096, since an admin will fix it on
--     assignment.
--   - Branch B has already resolved a specific package/partner, i.e.
--     the booking is meant to be fully priced now — a Transport
--     category package with no valid transport_mode at this point is
--     a data-integrity bug, not a valid draft state, so it now RAISES
--     instead of silently defaulting. This is a deliberate behavior
--     change from pre-096 (which silently used whatever `quantity`
--     was sent); worth a second pair of eyes before this ships, since
--     the RPC is only reachable by service_role callers today but
--     could reject a caller that was previously (incorrectly) served.
--
-- Existing pre-059 round_trip rows persisted at quantity=1 are NOT
-- bulk-updated by this migration — per instruction, those need
-- business-context review order by order before touching them.
--
-- Every other line of the function below is byte-for-byte identical
-- to the live definition from migration 059.
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
            -- Fix (059 + 096): transport quantity follows the
            -- business rule by mode, not the raw client `quantity`:
            --   round_trip           -> 2, always (two priced legs)
            --   one_way               -> 1, always
            --   medical_assistance    -> 1, always
            --   daily                 -> client-supplied day count
            --                            (no date-range column exists
            --                            yet to derive this instead —
            --                            see migration header)
            --   NULL (mode not chosen yet) -> 1, same pre-059/096
            --                            fallback; an admin fixes this
            --                            on assignment.
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

                IF v_transport_mode = 'round_trip' THEN
                    v_quantity := 2;
                ELSIF v_transport_mode IN ('one_way', 'medical_assistance') THEN
                    v_quantity := 1;
                ELSIF v_transport_mode = 'daily' THEN
                    v_quantity := COALESCE((v_item->>'quantity')::NUMERIC, 1);
                    IF v_quantity <= 0 THEN
                        RAISE EXCEPTION 'quantity (days) must be positive for daily transport item';
                    END IF;
                ELSIF v_transport_mode IS NULL THEN
                    v_quantity := 1;
                ELSE
                    RAISE EXCEPTION 'unrecognized transport_mode % for transport item', v_transport_mode;
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
        -- derivation as migration 012/014/025/028/037/057/058/059.
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

        -- Fix (096): a resolved Transport-category package must not
        -- take quantity from the client as-is — the same round_trip
        -- = 2 / one_way = 1 / medical_assistance = 1 rule that Branch
        -- A enforces now applies here too, so price calculation right
        -- below (v_price := unit_price * v_quantity * v_room_quantity)
        -- always uses the DB-decided quantity, never a client value
        -- that could under/over-charge a round_trip. 'daily' is the
        -- one mode where the day count is legitimate client-supplied
        -- data (see migration header) — validated positive, not
        -- overridden. A Transport package reaching this branch with
        -- no valid transport_mode is a data-integrity bug (unlike
        -- Branch A, this item is meant to be fully priced right now)
        -- so it hard-fails instead of silently defaulting.
        IF v_service_type = 'transport' THEN
            v_transport_mode := NULLIF(v_item->>'transport_mode', '');

            IF v_transport_mode = 'round_trip' THEN
                v_quantity := 2;
            ELSIF v_transport_mode IN ('one_way', 'medical_assistance') THEN
                v_quantity := 1;
            ELSIF v_transport_mode = 'daily' THEN
                v_quantity := COALESCE((v_item->>'quantity')::NUMERIC, 1);
                IF v_quantity <= 0 THEN
                    RAISE EXCEPTION 'quantity (days) must be positive for daily transport package %', v_pkg.id;
                END IF;
            ELSE
                RAISE EXCEPTION 'package % is category Transport but transport_mode is missing or invalid (got %)', v_pkg.id, v_transport_mode;
            END IF;
        ELSE
            v_quantity := COALESCE((v_item->>'quantity')::NUMERIC, 1);
            IF v_quantity <= 0 THEN
                RAISE EXCEPTION 'quantity must be positive for package %', v_pkg.id;
            END IF;
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
