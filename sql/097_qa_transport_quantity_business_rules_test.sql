-- ============================================================
-- QA script for migration 096 — run AFTER 096 is applied.
-- Run this whole file as postgres/service_role in the Supabase SQL
-- editor (create_order_with_items() is SECURITY DEFINER and only
-- granted to service_role anyway — see migration 027).
--
-- Self-contained: reuses one already-published, active,
-- Transport-category package that must already exist in this
-- environment (transport has no dedicated partner picker in the UI,
-- so Branch B for transport is rarely exercised — if this query
-- returns nothing, seed one Transport partner + published package
-- before running the rest of this script). Everything this script
-- writes (orders + order_items) is created inside one transaction
-- and ROLLBACK'd at the end, whether the assertions pass or fail —
-- safe to re-run, leaves no residual data.
-- ============================================================

BEGIN;

DO $$
DECLARE
    v_customer_id       UUID;
    v_package_id        UUID;
    v_unit_price        NUMERIC(12,2);
    v_result             JSONB;
    v_order_id           UUID;
    v_persisted_quantity NUMERIC;
    v_persisted_price    NUMERIC(12,2);
    v_expected_price     NUMERIC(12,2);
BEGIN
    -- ------------------------------------------------------------
    -- Fixtures: reuse existing rows, don't invent new partners/
    -- packages (their schemas have grown too many NOT NULL columns
    -- across migrations 037/072/081/086 to hand-write safely here).
    -- ------------------------------------------------------------
    SELECT id INTO v_customer_id FROM public.customers LIMIT 1;
    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'QA setup: no rows in public.customers — seed at least one before running this script';
    END IF;

    SELECT p.id, COALESCE(p.special_price, p.original_price)
    INTO v_package_id, v_unit_price
    FROM public.packages p
    JOIN public.partners pa ON pa.id = p.partner_id
    WHERE pa.category = 'Transport'
      AND p.status = 'published'
      AND p.is_active = true
    LIMIT 1;

    IF v_package_id IS NULL THEN
        RAISE EXCEPTION 'QA setup: no published/active package under a Transport-category partner — seed one before running this script';
    END IF;

    RAISE NOTICE 'Using customer %, transport package % (unit_price %)', v_customer_id, v_package_id, v_unit_price;

    -- ------------------------------------------------------------
    -- (1) Branch B — round_trip package booking, client sends the
    -- CORRECT quantity (2). Sanity check before the regression test.
    -- Expected: quantity = 2, price = unit_price * 2.
    -- ------------------------------------------------------------
    v_result := public.create_order_with_items(
        v_customer_id,
        jsonb_build_array(jsonb_build_object(
            'package_id', v_package_id,
            'quantity', 2,
            'transport_mode', 'round_trip',
            'scheduled_date', (CURRENT_DATE + 7)::TEXT,
            'transport_return_date', (CURRENT_DATE + 9)::TEXT
        )),
        NULL, NULL, gen_random_uuid()
    );
    v_order_id := (v_result->>'order_id')::UUID;
    SELECT quantity, price INTO v_persisted_quantity, v_persisted_price
    FROM public.order_items WHERE order_id = v_order_id;
    v_expected_price := ROUND(v_unit_price * 2, 2);

    IF v_persisted_quantity <> 2 OR v_persisted_price <> v_expected_price THEN
        RAISE EXCEPTION '(1) FAIL round_trip (client sent 2): got quantity=%, price=% — expected quantity=2, price=%',
            v_persisted_quantity, v_persisted_price, v_expected_price;
    END IF;
    RAISE NOTICE '(1) PASS round_trip package booking -> quantity 2, price %', v_persisted_price;

    -- ------------------------------------------------------------
    -- (2) Branch B — THE regression test. Client sends round_trip
    -- with quantity = 1 (the exact bug reported). DB must override
    -- to 2 regardless, and price must be based on the overridden
    -- quantity, not the client's.
    -- Expected: quantity = 2, price = unit_price * 2 (NOT unit_price * 1).
    -- ------------------------------------------------------------
    v_result := public.create_order_with_items(
        v_customer_id,
        jsonb_build_array(jsonb_build_object(
            'package_id', v_package_id,
            'quantity', 1,                    -- deliberately wrong
            'transport_mode', 'round_trip',
            'scheduled_date', (CURRENT_DATE + 7)::TEXT,
            'transport_return_date', (CURRENT_DATE + 9)::TEXT
        )),
        NULL, NULL, gen_random_uuid()
    );
    v_order_id := (v_result->>'order_id')::UUID;
    SELECT quantity, price INTO v_persisted_quantity, v_persisted_price
    FROM public.order_items WHERE order_id = v_order_id;
    v_expected_price := ROUND(v_unit_price * 2, 2);

    IF v_persisted_quantity <> 2 OR v_persisted_price <> v_expected_price THEN
        RAISE EXCEPTION '(2) FAIL round_trip (client sent 1, must be overridden to 2): got quantity=%, price=% — expected quantity=2, price=%',
            v_persisted_quantity, v_persisted_price, v_expected_price;
    END IF;
    RAISE NOTICE '(2) PASS round_trip with client quantity=1 -> DB overrides to quantity 2, price %', v_persisted_price;

    -- ------------------------------------------------------------
    -- (3) Branch B — one_way package booking, client sends a wrong
    -- quantity (3) to prove one_way is also forced, not just trusted
    -- at 1 by coincidence.
    -- Expected: quantity = 1, price = unit_price * 1.
    -- ------------------------------------------------------------
    v_result := public.create_order_with_items(
        v_customer_id,
        jsonb_build_array(jsonb_build_object(
            'package_id', v_package_id,
            'quantity', 3,                    -- deliberately wrong
            'transport_mode', 'one_way',
            'scheduled_date', (CURRENT_DATE + 7)::TEXT
        )),
        NULL, NULL, gen_random_uuid()
    );
    v_order_id := (v_result->>'order_id')::UUID;
    SELECT quantity, price INTO v_persisted_quantity, v_persisted_price
    FROM public.order_items WHERE order_id = v_order_id;
    v_expected_price := ROUND(v_unit_price * 1, 2);

    IF v_persisted_quantity <> 1 OR v_persisted_price <> v_expected_price THEN
        RAISE EXCEPTION '(3) FAIL one_way (client sent 3): got quantity=%, price=% — expected quantity=1, price=%',
            v_persisted_quantity, v_persisted_price, v_expected_price;
    END IF;
    RAISE NOTICE '(3) PASS one_way package booking -> quantity 1, price %', v_persisted_price;

    -- ------------------------------------------------------------
    -- (4) Branch B — medical_assistance, same idea as (3).
    -- Expected: quantity = 1.
    -- ------------------------------------------------------------
    v_result := public.create_order_with_items(
        v_customer_id,
        jsonb_build_array(jsonb_build_object(
            'package_id', v_package_id,
            'quantity', 5,                    -- deliberately wrong
            'transport_mode', 'medical_assistance',
            'scheduled_date', (CURRENT_DATE + 7)::TEXT
        )),
        NULL, NULL, gen_random_uuid()
    );
    v_order_id := (v_result->>'order_id')::UUID;
    SELECT quantity, price INTO v_persisted_quantity, v_persisted_price
    FROM public.order_items WHERE order_id = v_order_id;
    v_expected_price := ROUND(v_unit_price * 1, 2);

    IF v_persisted_quantity <> 1 OR v_persisted_price <> v_expected_price THEN
        RAISE EXCEPTION '(4) FAIL medical_assistance (client sent 5): got quantity=%, price=% — expected quantity=1, price=%',
            v_persisted_quantity, v_persisted_price, v_expected_price;
    END IF;
    RAISE NOTICE '(4) PASS medical_assistance package booking -> quantity 1, price %', v_persisted_price;

    -- ------------------------------------------------------------
    -- (5) Branch B — daily package booking, client sends 3 days.
    -- This is the one mode that is NOT overridden by design (no
    -- date-range column to derive it from — see migration 096
    -- header) — client's day count should be trusted and priced.
    -- Expected: quantity = 3, price = unit_price * 3.
    -- ------------------------------------------------------------
    v_result := public.create_order_with_items(
        v_customer_id,
        jsonb_build_array(jsonb_build_object(
            'package_id', v_package_id,
            'quantity', 3,
            'transport_mode', 'daily',
            'scheduled_date', (CURRENT_DATE + 7)::TEXT
        )),
        NULL, NULL, gen_random_uuid()
    );
    v_order_id := (v_result->>'order_id')::UUID;
    SELECT quantity, price INTO v_persisted_quantity, v_persisted_price
    FROM public.order_items WHERE order_id = v_order_id;
    v_expected_price := ROUND(v_unit_price * 3, 2);

    IF v_persisted_quantity <> 3 OR v_persisted_price <> v_expected_price THEN
        RAISE EXCEPTION '(5) FAIL daily (3 days): got quantity=%, price=% — expected quantity=3, price=%',
            v_persisted_quantity, v_persisted_price, v_expected_price;
    END IF;
    RAISE NOTICE '(5) PASS daily package booking (3 days) -> quantity 3, price %', v_persisted_price;

    -- ------------------------------------------------------------
    -- (6) Branch B — daily with an invalid (non-positive) day count
    -- must still be rejected, same as before 096.
    -- Expected: RAISE EXCEPTION from the function itself.
    -- ------------------------------------------------------------
    BEGIN
        PERFORM public.create_order_with_items(
            v_customer_id,
            jsonb_build_array(jsonb_build_object(
                'package_id', v_package_id,
                'quantity', 0,
                'transport_mode', 'daily',
                'scheduled_date', (CURRENT_DATE + 7)::TEXT
            )),
            NULL, NULL, gen_random_uuid()
        );
        RAISE EXCEPTION '(6) FAIL daily with quantity=0 was accepted — should have been rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'quantity (days) must be positive%' THEN
                RAISE NOTICE '(6) PASS daily with quantity=0 correctly rejected: %', SQLERRM;
            ELSE
                RAISE; -- unexpected error — surface it, don't swallow
            END IF;
    END;

    -- ------------------------------------------------------------
    -- (7) Branch B — Transport package with missing/invalid
    -- transport_mode must now hard-fail (096 behavior change —
    -- previously this silently used the client's raw quantity).
    -- Expected: RAISE EXCEPTION from the function itself.
    -- ------------------------------------------------------------
    BEGIN
        PERFORM public.create_order_with_items(
            v_customer_id,
            jsonb_build_array(jsonb_build_object(
                'package_id', v_package_id,
                'quantity', 1,
                'scheduled_date', (CURRENT_DATE + 7)::TEXT
                -- transport_mode omitted on purpose
            )),
            NULL, NULL, gen_random_uuid()
        );
        RAISE EXCEPTION '(7) FAIL Transport package with no transport_mode was accepted — should have been rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE '%transport_mode is missing or invalid%' THEN
                RAISE NOTICE '(7) PASS Transport package with no transport_mode correctly rejected: %', SQLERRM;
            ELSE
                RAISE; -- unexpected error — surface it, don't swallow
            END IF;
    END;

    -- ------------------------------------------------------------
    -- (8) Branch A — "let team decide" daily transport, no
    -- package_id. This is the other bug 096 fixes: pre-096, Branch A
    -- silently forced ALL non-round_trip modes (including daily) to
    -- quantity 1, discarding the day count the customer picked.
    -- Expected: quantity = 4 (not 1).
    -- ------------------------------------------------------------
    v_result := public.create_order_with_items(
        v_customer_id,
        jsonb_build_array(jsonb_build_object(
            'service_type', 'transport',
            'quantity', 4,
            'transport_mode', 'daily',
            'scheduled_date', (CURRENT_DATE + 7)::TEXT
        )),
        NULL, NULL, gen_random_uuid()
    );
    v_order_id := (v_result->>'order_id')::UUID;
    SELECT quantity INTO v_persisted_quantity
    FROM public.order_items WHERE order_id = v_order_id;

    IF v_persisted_quantity <> 4 THEN
        RAISE EXCEPTION '(8) FAIL Branch A daily "let team decide" (4 days): got quantity=% — expected 4', v_persisted_quantity;
    END IF;
    RAISE NOTICE '(8) PASS Branch A daily "let team decide" -> quantity 4 (was silently forced to 1 before 096)';

    -- ------------------------------------------------------------
    -- (9) Branch A — "let team decide" round_trip still forces 2
    -- even if a caller sends a stray quantity field (Branch A never
    -- reads item->>'quantity' for non-daily transport, but confirm
    -- the 059 behavior wasn't disturbed by 096's refactor).
    -- Expected: quantity = 2.
    -- ------------------------------------------------------------
    v_result := public.create_order_with_items(
        v_customer_id,
        jsonb_build_array(jsonb_build_object(
            'service_type', 'transport',
            'quantity', 1,                    -- ignored for round_trip in Branch A
            'transport_mode', 'round_trip',
            'scheduled_date', (CURRENT_DATE + 7)::TEXT,
            'transport_return_date', (CURRENT_DATE + 9)::TEXT
        )),
        NULL, NULL, gen_random_uuid()
    );
    v_order_id := (v_result->>'order_id')::UUID;
    SELECT quantity INTO v_persisted_quantity
    FROM public.order_items WHERE order_id = v_order_id;

    IF v_persisted_quantity <> 2 THEN
        RAISE EXCEPTION '(9) FAIL Branch A round_trip "let team decide": got quantity=% — expected 2', v_persisted_quantity;
    END IF;
    RAISE NOTICE '(9) PASS Branch A round_trip "let team decide" still -> quantity 2 (059 behavior preserved)';

    RAISE NOTICE '=== ALL 096 QA CHECKS PASSED ===';
END $$;

-- Always discard everything this script wrote, pass or fail.
ROLLBACK;
