-- ============================================================
-- MIGRATION 036: idempotent order creation + return full order
-- details from create_order_with_items() in one round trip.
--
-- Built directly from the CURRENT production definition of
-- create_order_with_items() (confirmed via pg_get_functiondef on
-- 2026-08-20) — includes room_quantity / pickup_location /
-- dropoff_location already, so this does NOT regress migrations
-- 021/024/025/028.
--
-- Two problems, one fix:
--
-- 1. DUPLICATE ORDERS ON RETRY. route.ts previously did:
--        RPC create_order_with_items()  -- commits, order exists
--        SELECT totals FROM orders      -- separate round trip
--    If that second SELECT failed (network blip, cold start,
--    whatever), the customer saw "order created, failed to load
--    totals — refresh to retry" and, on retry, got a SECOND order
--    created for the same booking (no idempotency key existed to
--    recognize the retry as the same request).
--
-- 2. This migration closes it two ways at once:
--    a) p_client_request_id — a UUID the browser generates once per
--       booking attempt and re-sends unchanged on any retry of that
--       SAME attempt. A unique index on orders.client_request_id
--       means a retried request returns the ALREADY-CREATED order
--       instead of creating a new one — enforced at the DB level,
--       not just "best effort" in application code.
--    b) The function now returns order_number/total_amount/
--       total_deposit_required/currency/payment_access_token
--       directly, in the SAME transaction/round-trip that creates
--       the order — removing the separate post-RPC SELECT in
--       route.ts entirely, which removes the failure window that
--       caused problem #1 in the first place. The idempotency key
--       (a) is still kept as defense in depth for other retry
--       causes (client-side timeout before the response arrives,
--       double-tap on a slow connection, etc).
--
-- REVIEW FIXES (post-initial-draft):
--    c) Both idempotency check paths now also compare patient_id.
--       A client_request_id is scoped to one patient's one booking
--       attempt — if the same id ever turns up against a DIFFERENT
--       patient_id (client bug reusing a UUID, or a deliberate
--       collision attempt), the function raises instead of handing
--       back that patient's order to someone else.
--    d) The concurrent-insert path uses ON CONFLICT (client_request_
--       id) WHERE client_request_id IS NOT NULL DO NOTHING, scoped
--       to the exact partial unique index
--       (orders_client_request_id_unique) — resolved by the planner
--       against that specific index, not by catching a bare
--       unique_violation / string-matching SQLERRM. It cannot
--       accidentally trigger on some future/unrelated unique
--       constraint on orders (e.g. order_number).
-- ============================================================

-- ------------------------------------------------------------
-- 1. orders: idempotency key. Nullable — older rows and any
--    direct/manual inserts don't need one. Partial unique index
--    (WHERE client_request_id IS NOT NULL) so multiple NULLs don't
--    conflict with each other.
-- ------------------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS orders_client_request_id_unique
    ON public.orders (client_request_id)
    WHERE client_request_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. create_order_with_items(): add p_client_request_id, and return
--    the full order summary instead of just order_id/order_number.
--    Body otherwise unchanged from the current production version
--    (room_quantity / pickup_location / dropoff_location logic
--    copied as-is).
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
    v_unit_price NUMERIC(12,2);
    v_price NUMERIC(12,2);
    v_deposit NUMERIC(12,2);
    v_is_unassigned BOOLEAN;
    v_existing RECORD;
    v_result JSONB;
BEGIN
    -- --------------------------------------------------------
    -- Idempotency check #1: an earlier attempt with this exact
    -- client_request_id already succeeded — hand back that same
    -- order instead of creating a new one. Cheap early-out for the
    -- common retry case (no race involved).
    -- --------------------------------------------------------
    IF p_client_request_id IS NOT NULL THEN
        SELECT id, order_number, total_amount, total_deposit_required,
               currency, payment_access_token, patient_id
        INTO v_existing
        FROM public.orders
        WHERE client_request_id = p_client_request_id;

        IF FOUND THEN
            -- A client_request_id is meant to identify exactly one
            -- booking attempt by exactly one patient. If it shows up
            -- attached to a DIFFERENT patient_id, something is wrong
            -- (client bug reusing a UUID, or a deliberate collision
            -- attempt) — refuse to hand back someone else's order
            -- instead of silently treating it as a normal replay.
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
    -- Idempotency check #2 (the race): two concurrent requests with
    -- the SAME client_request_id can both pass check #1 above (both
    -- ran their SELECT before either INSERT committed). ON CONFLICT
    -- is scoped to the exact partial unique index
    -- (orders_client_request_id_unique) rather than catching a bare
    -- unique_violation — this is resolved by the planner against
    -- that specific index, not by string-matching SQLERRM, so it
    -- can't accidentally trigger on a future/unrelated unique
    -- constraint on orders (e.g. order_number). When p_client_
    -- request_id IS NULL this clause never matches (NULL <> NULL in
    -- a unique index), so a plain INSERT happens as normal.
    -- --------------------------------------------------------
    INSERT INTO public.orders (patient_id, status, notes, attachment_url, client_request_id)
    VALUES (p_patient_id, 'draft', p_notes, p_attachment_url, p_client_request_id)
    ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
    RETURNING id, order_number INTO v_order_id, v_order_number;

    IF NOT FOUND THEN
        -- Lost the race on client_request_id — some other concurrent
        -- call already inserted the row for this exact id.
        SELECT id, order_number, total_amount, total_deposit_required,
               currency, payment_access_token, patient_id
        INTO v_existing
        FROM public.orders
        WHERE client_request_id = p_client_request_id;

        -- Same patient_id guard as idempotency check #1 above, for
        -- the concurrent-request path: the loser of the race must
        -- not be handed the winner's order if it belongs to a
        -- different patient.
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
        -- derivation as migration 012/014/025/028.
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

    -- Read totals back in the SAME transaction that inserted the
    -- order_items rows — whatever trigger sums price/deposit_required
    -- into orders.total_amount/total_deposit_required has already
    -- fired by this point (Postgres triggers are immediate, not
    -- deferred, unless explicitly declared otherwise). This is the
    -- read that used to be a SEPARATE round trip from route.ts —
    -- moving it in here is what removes that failure window.
    --
    -- ASSUMPTION FLAGGED FOR REVIEW: this assumes total_amount /
    -- total_deposit_required / currency / payment_access_token are
    -- all populated by the time this SELECT runs (via trigger or
    -- column default) — confirmed these columns exist and route.ts
    -- could already read them after the RPC returned, but the
    -- trigger/default definition itself wasn't reviewed here. Verify
    -- in staging that a booking with multiple items returns correct
    -- non-null totals before relying on this in production.
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

REVOKE ALL ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT, TEXT, UUID) TO service_role;

-- Supersede the 4-arg signature — without this, Postgres keeps both
-- as separate overloads and route.ts must always call the new 5-arg
-- form (passing client_request_id as null if truly absent).
DROP FUNCTION IF EXISTS public.create_order_with_items(UUID, JSONB, TEXT, TEXT);
