-- ============================================================================
-- 108_qa_settlement_functions_test.sql
--
-- QA script for 107_settlement_functions.sql (calculate/approve/pay/
-- lock_settlement). Run this whole file as postgres/service_role in
-- the Supabase SQL editor, AFTER 105 and 107 are both applied.
--
-- Same convention as 097_qa_transport_quantity_business_rules_test.sql:
--   - Self-contained: reuses one existing customer + one existing
--     published/active package (any non-Hotel/Transport category, so
--     create_order_with_items() doesn't need transport_mode/
--     hotel_checkout_date) rather than hand-writing every NOT NULL
--     column order_items has grown across migrations 008-107.
--   - Everything runs inside one outer transaction (BEGIN ... ROLLBACK
--     at the bottom) — safe to re-run, leaves no residual data,
--     whether the assertions pass or fail.
--   - Each numbered check RAISE NOTICEs on PASS, RAISE EXCEPTIONs on
--     FAIL. Checks that must themselves trigger a named RPC exception
--     wrap the call in a nested BEGIN/EXCEPTION block (Postgres gives
--     plpgsql an implicit savepoint per block, so a caught expected
--     error only unwinds that one call, not the whole script) and
--     assert on SQLERRM, re-RAISEing anything unexpected rather than
--     swallowing it.
--
-- ISOLATION FROM REAL DATA: the test's completed_at is pinned to
-- 1900-01-01 (and the settlement period to the same single day) —
-- not "yesterday" or "this month". calculate_settlement's eligibility
-- window is a plain BETWEEN over completed_at across the WHOLE
-- partner, so if the test used any real-world-plausible date range,
-- a partner with unrelated real completed order_items in that same
-- window would silently get folded into the test's totals, and
-- assertions on exact item_count/total_commission_due would become
-- flaky depending on what else exists in the environment. No real
-- order was ever completed in 1900, so this window is guaranteed
-- empty except for what this script inserts itself.
--
-- WHAT THIS DOES NOT COVER: true concurrent-session races (two admins
-- clicking Approve at the same instant, two calculate_settlement
-- calls for the same partner overlapping). That needs two separate
-- Postgres backends running at once, which a single script/session
-- can't simulate — see the MANUAL CONCURRENCY CHECK block at the very
-- end of this file for how to verify that by hand in staging. What
-- IS covered here is the sequential half of the same guarantee: that
-- the WHERE status = '<required>' claim actually rejects a second
-- call once the first has already moved the row past that status —
-- which is the exact mechanism the concurrency guarantee depends on.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_customer_id         UUID;
    v_package_id          UUID;
    v_partner_id          UUID;
    v_other_partner_id    UUID;
    v_result              JSONB;
    v_order_id            UUID;
    v_order_item_id       UUID;
    v_expected_commission NUMERIC(14,2);
    v_settlement_id       UUID;
    v_settlements_before  INTEGER;
    v_settlements_after   INTEGER;
    v_item_count          INTEGER;
    v_total_due           NUMERIC(14,2);
    v_frozen_commission   NUMERIC(14,2);
    v_status              TEXT;
BEGIN
    -- ------------------------------------------------------------
    -- Fixtures
    -- ------------------------------------------------------------
    SELECT id INTO v_customer_id FROM public.customers LIMIT 1;
    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'QA setup: no rows in public.customers — seed at least one before running this script';
    END IF;

    -- Any non-Hotel/Transport category package keeps
    -- create_order_with_items() on its simplest branch (no
    -- transport_mode / hotel_checkout_date required) — see file
    -- header. category -> service_type mapping is 096's own.
    SELECT p.id, p.partner_id
    INTO v_package_id, v_partner_id
    FROM public.packages p
    JOIN public.partners pa ON pa.id = p.partner_id
    WHERE p.status = 'published'
      AND p.is_active = true
      AND pa.category IN ('Hospital', 'Clinic', 'Dental', 'Wellness', 'Spa')
    LIMIT 1;

    IF v_package_id IS NULL THEN
        RAISE EXCEPTION 'QA setup: no published/active package under a Hospital/Clinic/Dental/Wellness/Spa partner — seed one before running this script';
    END IF;

    -- A second, distinct partner purely so test (14) below (a
    -- well-formed call with genuinely nothing eligible) doesn't reuse
    -- v_partner_id, whose 1900-01-01 item test (3) already settled —
    -- reusing it there would exercise the SAME no_eligible_items path
    -- as test (4) rather than a fresh one, and wouldn't prove
    -- no_eligible_items and partner_not_found are actually distinct
    -- outcomes for two different kinds of "nothing happened" input.
    SELECT id INTO v_other_partner_id
    FROM public.partners
    WHERE id <> v_partner_id
    LIMIT 1;
    IF v_other_partner_id IS NULL THEN
        RAISE EXCEPTION 'QA setup: need at least 2 partners in this environment for test (14)';
    END IF;

    RAISE NOTICE 'Using customer %, package % (partner %), second partner %',
        v_customer_id, v_package_id, v_partner_id, v_other_partner_id;

    -- ------------------------------------------------------------
    -- Create one real order_item via the existing, already-tested
    -- create_order_with_items() RPC (avoids hand-writing every
    -- NOT NULL column order_items has grown since 008 — same
    -- reasoning as 097). Then force it into settlement-eligible shape
    -- with deterministic, collision-proof values:
    --   status='completed', completed_at=1900-01-01 (see header),
    --   price=1000, deposit_required=200 -> partner_balance=800,
    --   which the 103 trigger turns into a >0 commission_amount
    --   regardless of this partner's actual commercial_fee_rate
    --   (falls back to the 12% MOU default if unset).
    -- ------------------------------------------------------------
    v_result := public.create_order_with_items(
        v_customer_id,
        jsonb_build_array(jsonb_build_object(
            'package_id', v_package_id,
            'quantity', 1,
            'scheduled_date', (CURRENT_DATE + 7)::TEXT
        )),
        NULL, NULL, gen_random_uuid()
    );
    v_order_id := (v_result->>'order_id')::UUID;

    SELECT id INTO v_order_item_id FROM public.order_items WHERE order_id = v_order_id LIMIT 1;
    IF v_order_item_id IS NULL THEN
        RAISE EXCEPTION 'QA setup: create_order_with_items did not produce an order_item';
    END IF;

    UPDATE public.order_items
    SET status = 'completed',
        completed_at = TIMESTAMPTZ '1900-01-01 00:00:00+00',
        price = 1000.00,
        deposit_required = 200.00
    WHERE id = v_order_item_id;

    SELECT commission_amount INTO v_expected_commission
    FROM public.order_items WHERE id = v_order_item_id;

    IF v_expected_commission IS NULL OR v_expected_commission <= 0 THEN
        RAISE EXCEPTION 'QA setup: test order_item % ended up with commission_amount % (expected > 0)',
            v_order_item_id, v_expected_commission;
    END IF;

    RAISE NOTICE 'QA setup: order_item % completed, commission_amount = %', v_order_item_id, v_expected_commission;

    -- ============================================================
    -- calculate_settlement
    -- ============================================================

    -- (1) invalid_period: end before start.
    BEGIN
        PERFORM public.calculate_settlement(v_partner_id, DATE '1900-01-02', DATE '1900-01-01', gen_random_uuid());
        RAISE EXCEPTION '(1) FAIL invalid_period was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'invalid_period%' THEN
                RAISE NOTICE '(1) PASS invalid_period correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;

    -- (2) partner_not_found: a partner id that doesn't exist.
    BEGIN
        PERFORM public.calculate_settlement(gen_random_uuid(), DATE '1900-01-01', DATE '1900-01-01', gen_random_uuid());
        RAISE EXCEPTION '(2) FAIL partner_not_found was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'partner_not_found%' THEN
                RAISE NOTICE '(2) PASS partner_not_found correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;

    -- (3) Happy path: exactly our one eligible item -> CALCULATED,
    -- with item_count/total matching that one item exactly (safe to
    -- assert exactly, not just >=, because of the 1900-01-01 isolation
    -- — see file header).
    v_result := public.calculate_settlement(v_partner_id, DATE '1900-01-01', DATE '1900-01-01', gen_random_uuid());
    v_settlement_id := (v_result->>'settlementId')::UUID;

    SELECT item_count, total_commission_due, status
    INTO v_item_count, v_total_due, v_status
    FROM public.settlements WHERE id = v_settlement_id;

    IF v_status <> 'CALCULATED' OR v_item_count <> 1 OR v_total_due <> v_expected_commission THEN
        RAISE EXCEPTION '(3) FAIL calculate_settlement: got status=%, item_count=%, total=% — expected CALCULATED, 1, %',
            v_status, v_item_count, v_total_due, v_expected_commission;
    END IF;

    SELECT commission_amount INTO v_frozen_commission
    FROM public.settlement_items
    WHERE settlement_id = v_settlement_id AND order_item_id = v_order_item_id;

    IF v_frozen_commission IS DISTINCT FROM v_expected_commission THEN
        RAISE EXCEPTION '(3) FAIL settlement_items froze commission_amount=% for order_item % — expected %',
            v_frozen_commission, v_order_item_id, v_expected_commission;
    END IF;
    RAISE NOTICE '(3) PASS calculate_settlement -> settlement % (CALCULATED, 1 item, total %, correctly frozen)',
        v_settlement_id, v_total_due;

    -- (4) Re-running the SAME partner+period: the one eligible item is
    -- now already settled, so this must fail with no_eligible_items,
    -- AND must not leave a second, empty settlement row behind (107's
    -- documented rollback-on-empty behavior).
    SELECT COUNT(*) INTO v_settlements_before
    FROM public.settlements WHERE partner_id = v_partner_id AND period_start = DATE '1900-01-01' AND period_end = DATE '1900-01-01';

    BEGIN
        PERFORM public.calculate_settlement(v_partner_id, DATE '1900-01-01', DATE '1900-01-01', gen_random_uuid());
        RAISE EXCEPTION '(4) FAIL re-calculating an already-settled period was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'no_eligible_items%' THEN
                RAISE NOTICE '(4) PASS re-calculating already-settled period correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;

    SELECT COUNT(*) INTO v_settlements_after
    FROM public.settlements WHERE partner_id = v_partner_id AND period_start = DATE '1900-01-01' AND period_end = DATE '1900-01-01';

    IF v_settlements_after <> v_settlements_before THEN
        RAISE EXCEPTION '(4) FAIL no_eligible_items left a residual settlement row behind: % before, % after',
            v_settlements_before, v_settlements_after;
    END IF;
    RAISE NOTICE '(4) PASS no residual settlement row left behind by the failed re-calculation';

    -- (14, checked here since it's the same RPC as 1-4) A genuinely
    -- clean partner+period with nothing eligible at all — distinct
    -- from (2)'s partner_not_found: this partner DOES exist, the
    -- period is well-formed, there's just nothing to settle.
    BEGIN
        PERFORM public.calculate_settlement(v_other_partner_id, DATE '1900-01-01', DATE '1900-01-01', gen_random_uuid());
        RAISE EXCEPTION '(14) FAIL calculate_settlement for a partner with nothing eligible was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'no_eligible_items%' THEN
                RAISE NOTICE '(14) PASS genuinely-empty partner+period correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;

    -- ============================================================
    -- approve_settlement / pay_settlement / lock_settlement
    --
    -- v_settlement_id is CALCULATED at this point (from test 3).
    -- Each block below both proves the wrong-status guard for the
    -- OTHER two RPCs (can't skip ahead) and then performs the real
    -- transition, walking the settlement CALCULATED -> APPROVED ->
    -- PAID -> LOCKED one step at a time.
    -- ============================================================

    -- (5) approve_settlement on a nonexistent id.
    BEGIN
        PERFORM public.approve_settlement(gen_random_uuid(), gen_random_uuid());
        RAISE EXCEPTION '(5) FAIL approve_settlement on nonexistent id was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'settlement_not_found%' THEN
                RAISE NOTICE '(5) PASS approve_settlement(nonexistent) correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;

    -- (6) Can't skip ahead: pay/lock while still CALCULATED.
    BEGIN
        PERFORM public.pay_settlement(v_settlement_id, gen_random_uuid());
        RAISE EXCEPTION '(6a) FAIL pay_settlement while CALCULATED was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'settlement_not_payable%' THEN
                RAISE NOTICE '(6a) PASS pay_settlement while CALCULATED correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;
    BEGIN
        PERFORM public.lock_settlement(v_settlement_id, gen_random_uuid());
        RAISE EXCEPTION '(6b) FAIL lock_settlement while CALCULATED was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'settlement_not_lockable%' THEN
                RAISE NOTICE '(6b) PASS lock_settlement while CALCULATED correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;

    -- (7) approve_settlement happy path: CALCULATED -> APPROVED.
    v_result := public.approve_settlement(v_settlement_id, gen_random_uuid());
    SELECT status INTO v_status FROM public.settlements WHERE id = v_settlement_id;
    IF v_status <> 'APPROVED' OR (v_result->>'status') <> 'APPROVED' THEN
        RAISE EXCEPTION '(7) FAIL approve_settlement: row status=%, returned status=% — expected APPROVED',
            v_status, v_result->>'status';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.settlements WHERE id = v_settlement_id AND approved_by IS NOT NULL AND approved_at IS NOT NULL) THEN
        RAISE EXCEPTION '(7) FAIL approve_settlement did not stamp approved_by/approved_at';
    END IF;
    RAISE NOTICE '(7) PASS approve_settlement -> APPROVED, approved_by/approved_at stamped';

    -- (8) Double-approve: the atomic-claim guard (single session
    -- proxy for the two-admins-race protection — see file header).
    BEGIN
        PERFORM public.approve_settlement(v_settlement_id, gen_random_uuid());
        RAISE EXCEPTION '(8) FAIL re-approving an already-approved settlement was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'settlement_not_approvable%' THEN
                RAISE NOTICE '(8) PASS double-approve correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;

    -- (9) Can't skip ahead from APPROVED: lock while still APPROVED.
    BEGIN
        PERFORM public.lock_settlement(v_settlement_id, gen_random_uuid());
        RAISE EXCEPTION '(9) FAIL lock_settlement while APPROVED was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'settlement_not_lockable%' THEN
                RAISE NOTICE '(9) PASS lock_settlement while APPROVED correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;

    -- (10) pay_settlement happy path: APPROVED -> PAID.
    v_result := public.pay_settlement(v_settlement_id, gen_random_uuid());
    SELECT status INTO v_status FROM public.settlements WHERE id = v_settlement_id;
    IF v_status <> 'PAID' OR (v_result->>'status') <> 'PAID' THEN
        RAISE EXCEPTION '(10) FAIL pay_settlement: row status=%, returned status=% — expected PAID',
            v_status, v_result->>'status';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.settlements WHERE id = v_settlement_id AND paid_by IS NOT NULL AND paid_at IS NOT NULL) THEN
        RAISE EXCEPTION '(10) FAIL pay_settlement did not stamp paid_by/paid_at';
    END IF;
    RAISE NOTICE '(10) PASS pay_settlement -> PAID, paid_by/paid_at stamped';

    -- (11) Double-pay.
    BEGIN
        PERFORM public.pay_settlement(v_settlement_id, gen_random_uuid());
        RAISE EXCEPTION '(11) FAIL re-paying an already-paid settlement was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'settlement_not_payable%' THEN
                RAISE NOTICE '(11) PASS double-pay correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;

    -- (12) lock_settlement happy path: PAID -> LOCKED.
    v_result := public.lock_settlement(v_settlement_id, gen_random_uuid());
    SELECT status INTO v_status FROM public.settlements WHERE id = v_settlement_id;
    IF v_status <> 'LOCKED' OR (v_result->>'status') <> 'LOCKED' THEN
        RAISE EXCEPTION '(12) FAIL lock_settlement: row status=%, returned status=% — expected LOCKED',
            v_status, v_result->>'status';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.settlements WHERE id = v_settlement_id AND locked_by IS NOT NULL AND locked_at IS NOT NULL) THEN
        RAISE EXCEPTION '(12) FAIL lock_settlement did not stamp locked_by/locked_at';
    END IF;
    RAISE NOTICE '(12) PASS lock_settlement -> LOCKED, locked_by/locked_at stamped';

    -- (13) LOCKED is terminal: every transition (including a second
    -- lock) must now be rejected — nothing reopens a locked
    -- settlement.
    BEGIN
        PERFORM public.approve_settlement(v_settlement_id, gen_random_uuid());
        RAISE EXCEPTION '(13a) FAIL approve_settlement on a LOCKED settlement was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'settlement_not_approvable%' THEN
                RAISE NOTICE '(13a) PASS approve_settlement on LOCKED correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;
    BEGIN
        PERFORM public.pay_settlement(v_settlement_id, gen_random_uuid());
        RAISE EXCEPTION '(13b) FAIL pay_settlement on a LOCKED settlement was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'settlement_not_payable%' THEN
                RAISE NOTICE '(13b) PASS pay_settlement on LOCKED correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;
    BEGIN
        PERFORM public.lock_settlement(v_settlement_id, gen_random_uuid());
        RAISE EXCEPTION '(13c) FAIL re-locking an already-LOCKED settlement was not rejected';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'settlement_not_lockable%' THEN
                RAISE NOTICE '(13c) PASS re-lock correctly rejected: %', SQLERRM;
            ELSE
                RAISE;
            END IF;
    END;

    RAISE NOTICE '=== ALL SETTLEMENT ENGINE QA CHECKS PASSED ===';
END $$;

-- Always discard everything this script wrote, pass or fail.
ROLLBACK;

-- ============================================================================
-- MANUAL CONCURRENCY CHECK (staging only, not run by this script)
--
-- The sequential checks above (8, 11, 13c) prove the WHERE status =
-- '<required>' claim rejects a second call once the row has already
-- moved past that status. What they can't prove from a single session
-- is the actual race: two DIFFERENT sessions calling the SAME
-- transition on the SAME settlement (or two calculate_settlement
-- calls for the SAME partner) at the same instant. To verify that by
-- hand in staging with two separate SQL editor tabs / psql sessions:
--
--   Session A:
--     BEGIN;
--     SELECT public.calculate_settlement('<partner-uuid>', '2026-01-01', '2026-01-31', '<admin-uuid>');
--     -- do NOT commit yet — leave this transaction open
--
--   Session B (while A is still open):
--     SELECT public.calculate_settlement('<same-partner-uuid>', '2026-01-01', '2026-01-31', '<admin-uuid>');
--     -- expect this to BLOCK (not error, not double-insert) until
--     -- session A commits or rolls back — that's the FOR UPDATE
--     -- partner-row lock (107's header) actually serializing the two
--     -- calls. If B returns immediately instead of blocking, the
--     -- lock isn't doing its job.
--
--   Session A:
--     COMMIT;
--     -- session B should now either proceed and succeed (if A rolled
--     -- back or the period had more eligible items left) or raise
--     -- no_eligible_items (if A's commit already claimed everything
--     -- eligible) — either way, never a duplicate settlement_items
--     -- row for the same order_item (blocked structurally by
--     -- settlement_items.order_item_id UNIQUE regardless).
--
-- Same pattern for approve/pay/lock_settlement: open a transaction in
-- session A that calls e.g. approve_settlement and don't commit, then
-- call approve_settlement on the SAME settlement id from session B —
-- B should block until A finishes, then get a clean
-- settlement_not_approvable (not a double-approval) once A commits.
-- ============================================================================
