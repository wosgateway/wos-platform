-- 123_hotel_booking_availability_atomic.sql
--
-- Hotel booking integration:
-- 1) reserve room inventory atomically with the existing order RPC.
-- 2) require an explicit availability row for every booked night.
-- 3) lock each inventory row before decrementing, preventing oversell.
-- 4) keep "let team decide" hotel items unreserved until admin assignment.
--
-- The wrapper calls create_order_with_items() first inside the SAME
-- transaction. If inventory validation fails, PostgreSQL rolls back the
-- order too. Idempotent replays return before touching inventory.

CREATE OR REPLACE FUNCTION public.reserve_room_availability(
    p_package_id UUID,
    p_checkin DATE,
    p_checkout DATE,
    p_room_quantity INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_day DATE;
    v_available INTEGER;
BEGIN
    IF p_room_quantity IS NULL OR p_room_quantity <= 0 THEN
        RAISE EXCEPTION 'room_quantity must be positive';
    END IF;

    IF p_checkin IS NULL OR p_checkout IS NULL OR p_checkout <= p_checkin THEN
        RAISE EXCEPTION 'hotel checkout_date must be after checkin_date';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.packages pkg
        JOIN public.partners partner ON partner.id = pkg.partner_id
        WHERE pkg.id = p_package_id
          AND pkg.status = 'published'
          AND partner.category = 'Hotel'
    ) THEN
        RAISE EXCEPTION 'package % is not a published Hotel package', p_package_id;
    END IF;

    FOR v_day IN
        SELECT gs::DATE
        FROM generate_series(p_checkin, p_checkout - INTERVAL '1 day', INTERVAL '1 day') gs
    LOOP
        SELECT available_count
        INTO v_available
        FROM public.room_availability
        WHERE package_id = p_package_id
          AND date = v_day
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'hotel availability is not configured for %', v_day;
        END IF;

        IF v_available < p_room_quantity THEN
            RAISE EXCEPTION 'hotel has only % room(s) available on % (requested %)',
                v_available, v_day, p_room_quantity;
        END IF;
    END LOOP;

    FOR v_day IN
        SELECT gs::DATE
        FROM generate_series(p_checkin, p_checkout - INTERVAL '1 day', INTERVAL '1 day') gs
    LOOP
        UPDATE public.room_availability
        SET available_count = available_count - p_room_quantity,
            updated_at = now()
        WHERE package_id = p_package_id
          AND date = v_day;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_room_availability(UUID, DATE, DATE, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_room_availability(UUID, DATE, DATE, INTEGER)
  TO service_role;

-- Canonical booking wrapper. Existing order pricing/idempotency remains in
-- create_order_with_items(); this wrapper adds the atomic inventory step.
CREATE OR REPLACE FUNCTION public.create_order_with_hotel_availability(
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
    v_result JSONB;
    v_item JSONB;
    v_pkg RECORD;
    v_partner RECORD;
    v_checkin DATE;
    v_checkout DATE;
    v_rooms INTEGER;
BEGIN
    v_result := public.create_order_with_items(
        p_patient_id,
        p_items,
        p_notes,
        p_attachment_url,
        p_client_request_id
    );

    -- A retry of an already-created booking must never decrement inventory
    -- a second time.
    IF COALESCE((v_result->>'idempotent_replay')::BOOLEAN, FALSE) THEN
        RETURN v_result;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        -- Only a specifically selected package can reserve inventory.
        -- "service_type=hotel" means the team will assign the room later.
        IF NOT (v_item ? 'package_id') THEN
            CONTINUE;
        END IF;

        SELECT pkg.id, pkg.partner_id, partner.category
        INTO v_pkg
        FROM public.packages pkg
        JOIN public.partners partner ON partner.id = pkg.partner_id
        WHERE pkg.id = (v_item->>'package_id')::UUID;

        IF NOT FOUND OR v_pkg.category <> 'Hotel' THEN
            CONTINUE;
        END IF;

        v_checkin := NULLIF(v_item->>'scheduled_date', '')::DATE;
        v_checkout := NULLIF(v_item->>'hotel_checkout_date', '')::DATE;
        v_rooms := COALESCE((v_item->>'room_quantity')::INTEGER, 1);

        PERFORM public.reserve_room_availability(
            v_pkg.id,
            v_checkin,
            v_checkout,
            v_rooms
        );
    END LOOP;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order_with_hotel_availability(UUID, JSONB, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_hotel_availability(UUID, JSONB, TEXT, TEXT, UUID)
  TO service_role;
-- The availability reservation is intentionally separate from price_override.
-- Price overrides remain a partner calendar/reference feature for this phase;
-- the existing package price remains the authoritative booking price until
-- a dedicated dynamic-rate pricing migration is approved.
