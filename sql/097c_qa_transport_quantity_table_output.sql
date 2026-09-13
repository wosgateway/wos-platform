-- ============================================================
-- Table-output variant of 097_qa_transport_quantity_business_rules_test.sql
-- (v2 — fixes the set_config/GUC approach, which does NOT survive a
-- ROLLBACK: per Postgres docs, even session-level SET/set_config
-- issued inside a transaction is undone if that transaction rolls
-- back. This version uses a real TEMP TABLE for results instead.
--
-- Each test case runs inside its own inner BEGIN...EXCEPTION block,
-- which PL/pgSQL implicitly treats as a savepoint: the case
-- deliberately raises an exception when it's done (pass or fail),
-- which rolls back ONLY that case's order/order_items rows, then the
-- EXCEPTION handler logs the outcome into wos_qa_log — which is
-- NOT rolled back, because the INSERT happens after the rollback
-- point, in the surviving outer scope. At the very end we COMMIT
-- (not ROLLBACK): by then every test case's writes have already
-- been individually undone, so the only thing left to commit is the
-- temp table and its log rows.
--
-- Run this whole file as postgres/service_role in the Supabase SQL
-- Editor. Same requirements as 097 (existing customer row + a
-- published/active Transport-category package).
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS wos_qa_log;
CREATE TEMP TABLE wos_qa_log (
    step      INT GENERATED ALWAYS AS IDENTITY,
    test_case TEXT,
    status    TEXT,
    detail    TEXT
);

DO $$
DECLARE
    v_customer_id        UUID;
    v_package_id         UUID;
    v_unit_price         NUMERIC(12,2);
    v_result             JSONB;
    v_order_id           UUID;
    v_persisted_quantity NUMERIC;
    v_persisted_price    NUMERIC(12,2);
    v_expected_price     NUMERIC(12,2);
    v_ok                 BOOLEAN;
BEGIN
    SELECT id INTO v_customer_id FROM public.customers LIMIT 1;

    SELECT p.id, COALESCE(p.special_price, p.original_price)
    INTO v_package_id, v_unit_price
    FROM public.packages p
    JOIN public.partners pa ON pa.id = p.partner_id
    WHERE pa.category = 'Transport'
      AND p.status = 'published'
      AND p.is_active = true
    LIMIT 1;

    IF v_customer_id IS NULL THEN
        INSERT INTO wos_qa_log (test_case, status, detail)
        VALUES ('setup', 'FAIL', 'no rows in public.customers — seed at least one before running this script');

    ELSIF v_package_id IS NULL THEN
        INSERT INTO wos_qa_log (test_case, status, detail)
        VALUES ('setup', 'FAIL', 'no published/active Transport package found');

    ELSE
        INSERT INTO wos_qa_log (test_case, status, detail)
        VALUES ('setup', 'INFO', format('customer=%s, package=%s, unit_price=%s', v_customer_id, v_package_id, v_unit_price));

        -- (1) round_trip, client sends correct quantity 2
        BEGIN
            v_result := public.create_order_with_items(
                v_customer_id,
                jsonb_build_array(jsonb_build_object(
                    'package_id', v_package_id, 'quantity', 2,
                    'transport_mode', 'round_trip',
                    'scheduled_date', (CURRENT_DATE + 7)::TEXT,
                    'transport_return_date', (CURRENT_DATE + 9)::TEXT
                )), NULL, NULL, gen_random_uuid()
            );
            v_order_id := (v_result->>'order_id')::UUID;
            SELECT quantity, price INTO v_persisted_quantity, v_persisted_price FROM public.order_items WHERE order_id = v_order_id;
            v_expected_price := ROUND(v_unit_price * 2, 2);
            v_ok := (v_persisted_quantity = 2 AND v_persisted_price = v_expected_price);
            RAISE EXCEPTION 'CASE_DONE';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM = 'CASE_DONE' THEN
                IF v_ok THEN
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('1_round_trip_sends_2', 'PASS', format('quantity=2, price=%s', v_persisted_price));
                ELSE
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('1_round_trip_sends_2', 'FAIL', format('got quantity=%s price=%s, expected quantity=2 price=%s', v_persisted_quantity, v_persisted_price, v_expected_price));
                END IF;
            ELSE
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('1_round_trip_sends_2', 'FAIL', 'unexpected error: ' || SQLERRM);
            END IF;
        END;

        -- (2) THE regression test: round_trip, client sends 1 (must be overridden to 2)
        BEGIN
            v_result := public.create_order_with_items(
                v_customer_id,
                jsonb_build_array(jsonb_build_object(
                    'package_id', v_package_id, 'quantity', 1,
                    'transport_mode', 'round_trip',
                    'scheduled_date', (CURRENT_DATE + 7)::TEXT,
                    'transport_return_date', (CURRENT_DATE + 9)::TEXT
                )), NULL, NULL, gen_random_uuid()
            );
            v_order_id := (v_result->>'order_id')::UUID;
            SELECT quantity, price INTO v_persisted_quantity, v_persisted_price FROM public.order_items WHERE order_id = v_order_id;
            v_expected_price := ROUND(v_unit_price * 2, 2);
            v_ok := (v_persisted_quantity = 2 AND v_persisted_price = v_expected_price);
            RAISE EXCEPTION 'CASE_DONE';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM = 'CASE_DONE' THEN
                IF v_ok THEN
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('2_round_trip_client_sends_1_REGRESSION', 'PASS', format('DB overrode client 1 -> quantity=2, price=%s', v_persisted_price));
                ELSE
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('2_round_trip_client_sends_1_REGRESSION', 'FAIL', format('got quantity=%s price=%s, expected quantity=2 price=%s', v_persisted_quantity, v_persisted_price, v_expected_price));
                END IF;
            ELSE
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('2_round_trip_client_sends_1_REGRESSION', 'FAIL', 'unexpected error: ' || SQLERRM);
            END IF;
        END;

        -- (3) one_way, client sends wrong quantity 3
        BEGIN
            v_result := public.create_order_with_items(
                v_customer_id,
                jsonb_build_array(jsonb_build_object(
                    'package_id', v_package_id, 'quantity', 3,
                    'transport_mode', 'one_way',
                    'scheduled_date', (CURRENT_DATE + 7)::TEXT
                )), NULL, NULL, gen_random_uuid()
            );
            v_order_id := (v_result->>'order_id')::UUID;
            SELECT quantity, price INTO v_persisted_quantity, v_persisted_price FROM public.order_items WHERE order_id = v_order_id;
            v_expected_price := ROUND(v_unit_price * 1, 2);
            v_ok := (v_persisted_quantity = 1 AND v_persisted_price = v_expected_price);
            RAISE EXCEPTION 'CASE_DONE';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM = 'CASE_DONE' THEN
                IF v_ok THEN
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('3_one_way_client_sends_3', 'PASS', format('quantity=1, price=%s', v_persisted_price));
                ELSE
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('3_one_way_client_sends_3', 'FAIL', format('got quantity=%s price=%s, expected quantity=1 price=%s', v_persisted_quantity, v_persisted_price, v_expected_price));
                END IF;
            ELSE
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('3_one_way_client_sends_3', 'FAIL', 'unexpected error: ' || SQLERRM);
            END IF;
        END;

        -- (4) medical_assistance, client sends wrong quantity 5
        BEGIN
            v_result := public.create_order_with_items(
                v_customer_id,
                jsonb_build_array(jsonb_build_object(
                    'package_id', v_package_id, 'quantity', 5,
                    'transport_mode', 'medical_assistance',
                    'scheduled_date', (CURRENT_DATE + 7)::TEXT
                )), NULL, NULL, gen_random_uuid()
            );
            v_order_id := (v_result->>'order_id')::UUID;
            SELECT quantity, price INTO v_persisted_quantity, v_persisted_price FROM public.order_items WHERE order_id = v_order_id;
            v_expected_price := ROUND(v_unit_price * 1, 2);
            v_ok := (v_persisted_quantity = 1 AND v_persisted_price = v_expected_price);
            RAISE EXCEPTION 'CASE_DONE';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM = 'CASE_DONE' THEN
                IF v_ok THEN
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('4_medical_assistance_client_sends_5', 'PASS', format('quantity=1, price=%s', v_persisted_price));
                ELSE
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('4_medical_assistance_client_sends_5', 'FAIL', format('got quantity=%s price=%s, expected quantity=1 price=%s', v_persisted_quantity, v_persisted_price, v_expected_price));
                END IF;
            ELSE
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('4_medical_assistance_client_sends_5', 'FAIL', 'unexpected error: ' || SQLERRM);
            END IF;
        END;

        -- (5) daily, 3 days
        BEGIN
            v_result := public.create_order_with_items(
                v_customer_id,
                jsonb_build_array(jsonb_build_object(
                    'package_id', v_package_id, 'quantity', 3,
                    'transport_mode', 'daily',
                    'scheduled_date', (CURRENT_DATE + 7)::TEXT
                )), NULL, NULL, gen_random_uuid()
            );
            v_order_id := (v_result->>'order_id')::UUID;
            SELECT quantity, price INTO v_persisted_quantity, v_persisted_price FROM public.order_items WHERE order_id = v_order_id;
            v_expected_price := ROUND(v_unit_price * 3, 2);
            v_ok := (v_persisted_quantity = 3 AND v_persisted_price = v_expected_price);
            RAISE EXCEPTION 'CASE_DONE';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM = 'CASE_DONE' THEN
                IF v_ok THEN
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('5_daily_3_days', 'PASS', format('quantity=3, price=%s', v_persisted_price));
                ELSE
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('5_daily_3_days', 'FAIL', format('got quantity=%s price=%s, expected quantity=3 price=%s', v_persisted_quantity, v_persisted_price, v_expected_price));
                END IF;
            ELSE
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('5_daily_3_days', 'FAIL', 'unexpected error: ' || SQLERRM);
            END IF;
        END;

        -- (6) daily with quantity=0 must be rejected
        BEGIN
            PERFORM public.create_order_with_items(
                v_customer_id,
                jsonb_build_array(jsonb_build_object(
                    'package_id', v_package_id, 'quantity', 0,
                    'transport_mode', 'daily',
                    'scheduled_date', (CURRENT_DATE + 7)::TEXT
                )), NULL, NULL, gen_random_uuid()
            );
            RAISE EXCEPTION 'CASE_UNEXPECTED_ACCEPT';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE 'quantity (days) must be positive%' THEN
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('6_daily_quantity_zero_rejected', 'PASS', SQLERRM);
            ELSIF SQLERRM = 'CASE_UNEXPECTED_ACCEPT' THEN
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('6_daily_quantity_zero_rejected', 'FAIL', 'quantity=0 was accepted, should have been rejected');
            ELSE
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('6_daily_quantity_zero_rejected', 'FAIL', 'unexpected error: ' || SQLERRM);
            END IF;
        END;

        -- (7) missing transport_mode must hard-fail
        BEGIN
            PERFORM public.create_order_with_items(
                v_customer_id,
                jsonb_build_array(jsonb_build_object(
                    'package_id', v_package_id, 'quantity', 1,
                    'scheduled_date', (CURRENT_DATE + 7)::TEXT
                )), NULL, NULL, gen_random_uuid()
            );
            RAISE EXCEPTION 'CASE_UNEXPECTED_ACCEPT';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE '%transport_mode is missing or invalid%' THEN
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('7_missing_transport_mode_rejected', 'PASS', SQLERRM);
            ELSIF SQLERRM = 'CASE_UNEXPECTED_ACCEPT' THEN
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('7_missing_transport_mode_rejected', 'FAIL', 'was accepted, should have been rejected');
            ELSE
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('7_missing_transport_mode_rejected', 'FAIL', 'unexpected error: ' || SQLERRM);
            END IF;
        END;

        -- (8) Branch A daily "let team decide", 4 days
        BEGIN
            v_result := public.create_order_with_items(
                v_customer_id,
                jsonb_build_array(jsonb_build_object(
                    'service_type', 'transport', 'quantity', 4,
                    'transport_mode', 'daily',
                    'scheduled_date', (CURRENT_DATE + 7)::TEXT
                )), NULL, NULL, gen_random_uuid()
            );
            v_order_id := (v_result->>'order_id')::UUID;
            SELECT quantity INTO v_persisted_quantity FROM public.order_items WHERE order_id = v_order_id;
            v_ok := (v_persisted_quantity = 4);
            RAISE EXCEPTION 'CASE_DONE';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM = 'CASE_DONE' THEN
                IF v_ok THEN
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('8_branch_a_daily_4_days', 'PASS', 'quantity=4 (was silently forced to 1 before 096)');
                ELSE
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('8_branch_a_daily_4_days', 'FAIL', format('got quantity=%s, expected 4', v_persisted_quantity));
                END IF;
            ELSE
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('8_branch_a_daily_4_days', 'FAIL', 'unexpected error: ' || SQLERRM);
            END IF;
        END;

        -- (9) Branch A round_trip "let team decide" still forces 2
        BEGIN
            v_result := public.create_order_with_items(
                v_customer_id,
                jsonb_build_array(jsonb_build_object(
                    'service_type', 'transport', 'quantity', 1,
                    'transport_mode', 'round_trip',
                    'scheduled_date', (CURRENT_DATE + 7)::TEXT,
                    'transport_return_date', (CURRENT_DATE + 9)::TEXT
                )), NULL, NULL, gen_random_uuid()
            );
            v_order_id := (v_result->>'order_id')::UUID;
            SELECT quantity INTO v_persisted_quantity FROM public.order_items WHERE order_id = v_order_id;
            v_ok := (v_persisted_quantity = 2);
            RAISE EXCEPTION 'CASE_DONE';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM = 'CASE_DONE' THEN
                IF v_ok THEN
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('9_branch_a_round_trip_still_2', 'PASS', 'quantity=2 (059 behavior preserved)');
                ELSE
                    INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('9_branch_a_round_trip_still_2', 'FAIL', format('got quantity=%s, expected 2', v_persisted_quantity));
                END IF;
            ELSE
                INSERT INTO wos_qa_log (test_case, status, detail) VALUES ('9_branch_a_round_trip_still_2', 'FAIL', 'unexpected error: ' || SQLERRM);
            END IF;
        END;

        INSERT INTO wos_qa_log (test_case, status, detail)
        SELECT 'summary', CASE WHEN bool_and(status = 'PASS' OR status = 'INFO') THEN 'PASS' ELSE 'FAIL' END,
               CASE WHEN bool_and(status = 'PASS' OR status = 'INFO') THEN 'ALL 096 QA CHECKS PASSED' ELSE 'one or more cases FAILED — see rows above' END
        FROM wos_qa_log;
    END IF;
END $$;

-- All order/order_items writes from every test case were already
-- individually undone above (each case forces its own rollback via
-- the RAISE EXCEPTION + implicit savepoint trick). The only thing
-- left to persist is the temp table and its log rows.
COMMIT;

SELECT step, test_case, status, detail
FROM wos_qa_log
ORDER BY step;
