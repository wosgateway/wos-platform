-- ============================================================================
-- 107_settlement_functions.sql
--
-- Phase 1 of the Settlement Engine build (105 = schema, 106 = hard-delete
-- guard fix, this = the actual write path). Four RPCs, one per state
-- transition:
--
--   CALCULATED --approve_settlement--> APPROVED --pay_settlement--> PAID
--   --lock_settlement--> LOCKED
--
--   calculate_settlement()  (nothing) -> CALCULATED   [creates the row]
--   approve_settlement()    CALCULATED -> APPROVED
--   pay_settlement()        APPROVED   -> PAID
--   lock_settlement()       PAID       -> LOCKED
--
-- Why this is SQL and not API-route TypeScript (same reasoning as 022's
-- admin_verify_payment / 075's admin_hard_delete_partner, both already
-- established in this codebase):
--
--   - calculate_settlement() must SELECT eligible order_items and INSERT
--     settlement_items inside the SAME transaction, under a lock, or two
--     admins calculating a settlement for the same partner at the same
--     moment could both read an overlapping eligible set. This is
--     prevented here by taking FOR UPDATE on the partner row first —
--     order_items are exclusively partner-scoped (partner_id NOT NULL),
--     so no OTHER partner's settlement calculation can ever contend for
--     the same order_items, and a second concurrent call for the SAME
--     partner blocks on the partner lock until the first commits or
--     rolls back. By the time the second call proceeds, every order_item
--     the first call claimed already has a settlement_items row, and the
--     `NOT EXISTS` filter below excludes them — no double-claim is
--     possible, not even in the gap between two round trips.
--
--   - approve_settlement() / pay_settlement() / lock_settlement() each do
--     an atomic `UPDATE ... WHERE status = '<required-prior-status>'`
--     claim (identical shape to 022's `update ... where status in (...)`).
--     Only one concurrent caller can ever win that UPDATE; every other
--     caller gets zero rows back and a clean, named rejection instead of
--     silently double-transitioning a settlement (e.g. two admins both
--     clicking "Approve" at once).
--
-- Business rules encoded here (per the settlement engine spec, unchanged
-- from 105's header):
--   1. Money direction: partner owes WOS commission.
--   2. Settlement amount = settlement_items.commission_amount, never
--      partner_balance / partner_balance_confirmed.
--   3. Eligibility: order_items.status = 'completed' AND
--      completed_at IS NOT NULL AND commission_amount > 0.
--   4. Settlement period is an admin-chosen arbitrary [period_start,
--      period_end] range, matched against order_items.completed_at.
--   5. Use the existing frozen order_items.commission_amount as-is — do
--      NOT recompute historical commission inside this engine.
--   6. One order_item can only ever belong to one settlement — enforced
--      structurally by settlement_items.order_item_id being UNIQUE (105)
--      and defensively here by the NOT EXISTS filter, so a concurrent
--      insert racing the unique constraint fails loudly (unique_violation)
--      rather than silently, if the partner-lock serialization above were
--      ever bypassed by a future caller.
--
-- What stays in TypeScript (API routes, not written yet — Phase 2):
--   - requireAdmin() — same as every other RPC in this file's family,
--     these functions have no session context, trust their caller
--     completely, and are service_role-only (see REVOKE/GRANT below).
--   - audit_log write — logAdminAction() after each call, using the
--     admin's own id/email from requireAdmin() (already established
--     pattern in hard-delete/route.ts). Not done inside these functions:
--     audit_log.actor_user_id references auth.users(id), which the RPC
--     has no reliable way to distinguish from a merely-plausible-looking
--     UUID passed as an argument — logging is the route's job precisely
--     because requireAdmin() is what actually verified that id.
--
-- Safe to re-run (CREATE OR REPLACE, same signatures every time).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Audit columns for the three admin-action transitions.
--
-- 105 added created_by (who ran calculate_settlement) but not
-- approved_by / paid_by / locked_by — an omission given this table's own
-- stated purpose ("audit trail for a completed financial obligation",
-- 106's header). approved_at/paid_at/locked_at already exist; pairing
-- each with a *_by column costs nothing structurally and is the same
-- shape audit_log already uses (actor_user_id + created_at per action).
-- No FK to auth.users here (created_by has none either, and requireAdmin()
-- is the actual authorization gate) — kept consistent with 105 rather than
-- silently tightening a column it didn't define that way.
-- ----------------------------------------------------------------------------

ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS approved_by UUID NULL,
    ADD COLUMN IF NOT EXISTS paid_by UUID NULL,
    ADD COLUMN IF NOT EXISTS locked_by UUID NULL;

COMMENT ON COLUMN public.settlements.approved_by IS
'Admin (auth.users.id) who ran approve_settlement() for this row. NULL until APPROVED.';
COMMENT ON COLUMN public.settlements.paid_by IS
'Admin (auth.users.id) who ran pay_settlement() for this row. NULL until PAID.';
COMMENT ON COLUMN public.settlements.locked_by IS
'Admin (auth.users.id) who ran lock_settlement() for this row. NULL until LOCKED.';


-- ----------------------------------------------------------------------------
-- 1. calculate_settlement — (nothing) -> CALCULATED
--
-- Creates one settlement row plus one settlement_items row per eligible,
-- not-yet-settled order_item in [p_period_start, p_period_end] for
-- p_partner_id. Raises and rolls back the whole thing (including the
-- settlement row itself) if there is nothing eligible — no empty
-- settlements are ever left behind.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calculate_settlement(
    p_partner_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_partner RECORD;
    v_settlement_id UUID;
    v_item_count INT;
    v_total NUMERIC(14,2);
BEGIN
    IF p_period_start IS NULL OR p_period_end IS NULL THEN
        RAISE EXCEPTION 'invalid_period: period_start and period_end are required';
    END IF;

    IF p_period_end < p_period_start THEN
        RAISE EXCEPTION 'invalid_period: period_end before period_start';
    END IF;

    -- Lock the partner row first. order_items.partner_id is NOT NULL and
    -- scoped to exactly one partner, so this alone fully serializes any
    -- two concurrent calculate_settlement() calls for the SAME partner
    -- (the only case that could ever race over the same order_items) —
    -- see file header for why a different partner's concurrent call is
    -- never a contention risk.
    SELECT * INTO v_partner FROM public.partners WHERE id = p_partner_id FOR UPDATE;
    IF v_partner IS NULL THEN
        RAISE EXCEPTION 'partner_not_found';
    END IF;

    INSERT INTO public.settlements (
        partner_id, period_start, period_end, status, created_by
    ) VALUES (
        p_partner_id, p_period_start, p_period_end, 'CALCULATED', p_admin_id
    )
    RETURNING id INTO v_settlement_id;

    -- Eligibility (business rule 3) + period match on completed_at
    -- (rule 4) + never-settled-before (rule 6, structural backstop via
    -- settlement_items.order_item_id UNIQUE).
    INSERT INTO public.settlement_items (
        settlement_id, order_item_id, partner_balance, commission_amount
    )
    SELECT
        v_settlement_id,
        oi.id,
        COALESCE(oi.partner_balance, 0),
        oi.commission_amount
    FROM public.order_items oi
    WHERE oi.partner_id = p_partner_id
      AND oi.status = 'completed'
      AND oi.completed_at IS NOT NULL
      AND oi.completed_at::date BETWEEN p_period_start AND p_period_end
      AND oi.commission_amount > 0
      AND NOT EXISTS (
            SELECT 1 FROM public.settlement_items si
            WHERE si.order_item_id = oi.id
          );

    GET DIAGNOSTICS v_item_count = ROW_COUNT;

    IF v_item_count = 0 THEN
        -- Rolls back the settlement INSERT above too — function body is
        -- one implicit transaction, so no empty/zero-item settlement is
        -- ever persisted.
        RAISE EXCEPTION 'no_eligible_items: no unsettled completed order_items for this partner in the given period';
    END IF;

    SELECT COALESCE(SUM(commission_amount), 0)
    INTO v_total
    FROM public.settlement_items
    WHERE settlement_id = v_settlement_id;

    UPDATE public.settlements
    SET total_commission_due = v_total,
        item_count = v_item_count
    WHERE id = v_settlement_id;

    RETURN jsonb_build_object(
        'settlementId', v_settlement_id,
        'partnerId', p_partner_id,
        'periodStart', p_period_start,
        'periodEnd', p_period_end,
        'status', 'CALCULATED',
        'itemCount', v_item_count,
        'totalCommissionDue', v_total
    );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_settlement(UUID, DATE, DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_settlement(UUID, DATE, DATE, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.calculate_settlement(UUID, DATE, DATE, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_settlement(UUID, DATE, DATE, UUID) TO service_role;


-- ----------------------------------------------------------------------------
-- 2. approve_settlement — CALCULATED -> APPROVED
--
-- Atomic claim, same shape as 022's admin_verify_payment: only one
-- concurrent caller can win the UPDATE; everyone else gets a clean
-- rejection instead of double-approving.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_settlement(
    p_settlement_id UUID,
    p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_row RECORD;
BEGIN
    UPDATE public.settlements
    SET status = 'APPROVED',
        approved_at = NOW(),
        approved_by = p_admin_id
    WHERE id = p_settlement_id
      AND status = 'CALCULATED'
    RETURNING id, partner_id, total_commission_due, item_count, approved_at
    INTO v_row;

    IF v_row.id IS NULL THEN
        -- Distinguish "doesn't exist" from "exists but wrong status" —
        -- the latter is the far more likely case in normal admin use
        -- (double-click, stale tab) and deserves a more specific error
        -- than a blanket not-found.
        IF EXISTS (SELECT 1 FROM public.settlements WHERE id = p_settlement_id) THEN
            RAISE EXCEPTION 'settlement_not_approvable: not in CALCULATED status';
        ELSE
            RAISE EXCEPTION 'settlement_not_found';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'settlementId', v_row.id,
        'partnerId', v_row.partner_id,
        'status', 'APPROVED',
        'itemCount', v_row.item_count,
        'totalCommissionDue', v_row.total_commission_due,
        'approvedAt', v_row.approved_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_settlement(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_settlement(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.approve_settlement(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_settlement(UUID, UUID) TO service_role;


-- ----------------------------------------------------------------------------
-- 3. pay_settlement — APPROVED -> PAID
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pay_settlement(
    p_settlement_id UUID,
    p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_row RECORD;
BEGIN
    UPDATE public.settlements
    SET status = 'PAID',
        paid_at = NOW(),
        paid_by = p_admin_id
    WHERE id = p_settlement_id
      AND status = 'APPROVED'
    RETURNING id, partner_id, total_commission_due, item_count, paid_at
    INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.settlements WHERE id = p_settlement_id) THEN
            RAISE EXCEPTION 'settlement_not_payable: not in APPROVED status';
        ELSE
            RAISE EXCEPTION 'settlement_not_found';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'settlementId', v_row.id,
        'partnerId', v_row.partner_id,
        'status', 'PAID',
        'itemCount', v_row.item_count,
        'totalCommissionDue', v_row.total_commission_due,
        'paidAt', v_row.paid_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.pay_settlement(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_settlement(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.pay_settlement(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pay_settlement(UUID, UUID) TO service_role;


-- ----------------------------------------------------------------------------
-- 4. lock_settlement — PAID -> LOCKED
--
-- Terminal state. Nothing transitions out of LOCKED — there is no
-- unlock_settlement(). A locked settlement (and its settlement_items,
-- frozen since calculate_settlement) is the permanent financial record.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lock_settlement(
    p_settlement_id UUID,
    p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_row RECORD;
BEGIN
    UPDATE public.settlements
    SET status = 'LOCKED',
        locked_at = NOW(),
        locked_by = p_admin_id
    WHERE id = p_settlement_id
      AND status = 'PAID'
    RETURNING id, partner_id, total_commission_due, item_count, locked_at
    INTO v_row;

    IF v_row.id IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.settlements WHERE id = p_settlement_id) THEN
            RAISE EXCEPTION 'settlement_not_lockable: not in PAID status';
        ELSE
            RAISE EXCEPTION 'settlement_not_found';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'settlementId', v_row.id,
        'partnerId', v_row.partner_id,
        'status', 'LOCKED',
        'itemCount', v_row.item_count,
        'totalCommissionDue', v_row.total_commission_due,
        'lockedAt', v_row.locked_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_settlement(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_settlement(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.lock_settlement(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lock_settlement(UUID, UUID) TO service_role;


-- ============================================================================
-- VERIFY after running:
--
--   select proname, prosecdef from pg_proc
--   where proname in ('calculate_settlement','approve_settlement','pay_settlement','lock_settlement');
--   -- all 4 should show prosecdef = true
--
--   select routine_name, grantee, privilege_type from information_schema.routine_privileges
--   where routine_name in ('calculate_settlement','approve_settlement','pay_settlement','lock_settlement');
--   -- expect exactly one row per function: service_role / EXECUTE
--
-- Manual smoke test (staging, with a partner that has completed,
-- unsettled order_items with commission_amount > 0):
--
--   select public.calculate_settlement(
--     '<partner-uuid>', '2026-01-01', '2026-01-31', '<admin-uuid>'
--   );
--   -- expect: itemCount > 0, totalCommissionDue = sum of those items'
--   -- commission_amount
--
--   -- re-running calculate_settlement with the SAME period for the SAME
--   -- partner should now fail (those order_items are already settled):
--   select public.calculate_settlement(
--     '<same-partner-uuid>', '2026-01-01', '2026-01-31', '<admin-uuid>'
--   );
--   -- expect: ERROR: no_eligible_items
--
--   select public.approve_settlement('<settlement-uuid-from-above>', '<admin-uuid>');
--   select public.pay_settlement('<settlement-uuid-from-above>', '<admin-uuid>');
--   select public.lock_settlement('<settlement-uuid-from-above>', '<admin-uuid>');
--
--   -- each of the following should fail with a named *_not_* error,
--   -- not a silent no-op or a raw constraint violation:
--   select public.approve_settlement('<already-approved-settlement-uuid>', '<admin-uuid>'); -- settlement_not_approvable
--   select public.pay_settlement('<still-calculated-settlement-uuid>', '<admin-uuid>');      -- settlement_not_payable
--   select public.lock_settlement('<still-approved-settlement-uuid>', '<admin-uuid>');       -- settlement_not_lockable
-- ============================================================================
