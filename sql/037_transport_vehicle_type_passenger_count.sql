-- ============================================================
-- MIGRATION 037: vehicle_type + passenger_count for transport items,
-- plus 'medical_assistance' as a new transport_mode.
--
-- Built directly from the CURRENT production definition of
-- create_order_with_items() (5-arg form, migration 036 —
-- p_patient_id, p_items, p_notes, p_attachment_url,
-- p_client_request_id) — includes idempotency + atomic totals
-- already, so this does NOT regress migration 036.
--
-- Context: BookingForm.tsx / JourneyBookingForm.tsx's "transport"
-- step is being reordered so vehicle type + passenger count are
-- asked up front, independent of which Partner ends up fulfilling
-- the trip (Partner resolution still happens later, either directly
-- via package_id or via the existing "let team decide" → admin
-- assign → /quote/[orderNumber] pipeline — unchanged by this
-- migration). Both order_items insert branches (Branch A: unassigned
-- "let team decide"; Branch B: resolved package_id) get the two new
-- fields, same pattern as migration 028 did for room_quantity and
-- migration 025 did for pickup_location/dropoff_location.
--
-- Scope: transport items only, same as transport_mode/pickup_location/
-- dropoff_location already are. A non-transport item with vehicle_type
-- or passenger_count set is rejected server-side — same "never trust
-- the client for anything that touches price/scope" rule as
-- room_quantity's hotel-only guard in migration 028.
--
-- vehicle_type is intentionally NOT constrained to a fixed enum by a
-- CHECK — Partner fleet composition varies (Sedan/SUV/VIP Van/Medical
-- Transport today, more may be added later) and the UI dropdown is
-- the actual source of truth for valid options. If Boyd wants this
-- locked down at the DB level later, that's a follow-up migration,
-- not folded in here.
--
-- Also fixes a pre-existing gap unrelated to vehicle_type/passenger_count:
-- the packages.is_active column (added outside this sql/ folder's tracked
-- migrations, see src/lib/data.ts comments) was never checked by
-- create_order_with_items()'s package lookup — only status = 'published'
-- was. Folded in here since 037 hadn't been run yet. NOTE: the same gap
-- still exists in admin_assign_order_item() (migrations 016/017/018/032)
-- and is NOT fixed by this migration — those are already live, so fixing
-- them needs its own follow-up migration (CREATE OR REPLACE, since you
-- can't edit an already-applied migration file).
--
-- Also re-closes the anon/authenticated EXECUTE hole (migration 027)
-- on create_order_with_items(): CREATE OR REPLACE FUNCTION does NOT
-- preserve previously-revoked grants — every migration that touches
-- this function must re-run the anon/authenticated revoke, or it
-- silently reopens migration 027's hole. Same note as migration 028.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS passenger_count INTEGER;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS chk_order_items_passenger_count_positive;
ALTER TABLE public.order_items
  ADD CONSTRAINT chk_order_items_passenger_count_positive
    CHECK (passenger_count IS NULL OR passenger_count > 0);

-- transport_mode CHECK (migration 013) widened to include
-- medical_assistance alongside one_way/round_trip/daily.
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_transport_mode_check;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_transport_mode_check
    CHECK (transport_mode IS NULL OR transport_mode IN
      ('one_way', 'round_trip', 'daily', 'medical_assistance'));

COMMENT ON COLUMN public.order_items.vehicle_type IS
  'Vehicle category for a transport item (e.g. sedan/suv/vip_van/medical_transport) — free text, not DB-enum-constrained; the booking-form dropdown is the source of truth for valid values. Always NULL for non-transport items — enforced in create_order_with_items(). Set from BookingForm.tsx / JourneyBookingForm.tsx transport step.';

COMMENT ON COLUMN public.order_items.passenger_count IS
  'Number of travelers for a transport item. Always NULL for non-transport items — enforced in create_order_with_items(). Set from BookingForm.tsx / JourneyBookingForm.tsx transport step.';

-- ------------------------------------------------------------
-- create_order_with_items() update
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
    -- --------------------------------------------------------
    -- Idempotency check #1 (unchanged from migration 036).
    -- --------------------------------------------------------
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

    -- --------------------------------------------------------
    -- Idempotency check #2 (the race) — unchanged from migration 036.
    -- --------------------------------------------------------
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
            );

            CONTINUE;
        END IF;

        -- ----------------------------------------------------
        -- Branch B: resolved item — same price/partner/service_type
        -- derivation as migration 012/014/025/028.
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
            room_quantity, vehicle_type, passenger_count
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
            v_room_quantity, v_vehicle_type, v_passenger_count
        );
    END LOOP;

    UPDATE public.orders SET status = 'pending_deposit' WHERE id = v_order_id;

    -- Read totals back in the SAME transaction (unchanged from
    -- migration 036 — see that migration's header for why).
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

-- Signature unchanged from migration 036 (still 5-arg) — but see
-- migration 028's header note: CREATE OR REPLACE does not preserve
-- prior REVOKEs, so re-assert the full migration-027 lockdown
-- (anon/authenticated included, not just PUBLIC) here too.
REVOKE ALL ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT, TEXT, UUID)
  TO service_role;

-- ------------------------------------------------------------
-- NOT handled by this migration — admin_assign_order_item()
-- (migration 016/017/018). Same situation as migration 028 flagged
-- for room_quantity: when an admin resolves a "let team decide"
-- transport item, vehicle_type/passenger_count already sit on the
-- order_items row from Branch A above — nothing further needs to
-- flow through the assign RPC. Verify this holds when touching
-- api/admin/order-items/[id]/assign/route.ts, but no change is
-- expected there.
-- ------------------------------------------------------------
