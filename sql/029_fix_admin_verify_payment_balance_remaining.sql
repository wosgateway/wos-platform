-- ============================================================
-- MIGRATION 029: fix admin_verify_payment() never updating
-- orders.total_balance_remaining — "จ่ายแล้วแต่ปุ่มชำระเงินยังโชว์"
--
-- ROOT CAUSE:
-- Two different code paths update payment/balance state, and only
-- one of them was ever kept in sync:
--
--   1. partner_verify_payment() (migration 022, order_item_id IS
--      NOT NULL) writes to order_items.deposit_paid. That UPDATE
--      fires two triggers already defined in migration 008:
--        - sync_order_item_balance (BEFORE UPDATE OF price,
--          deposit_paid) recomputes that row's balance_remaining
--        - sync_order_totals (AFTER INSERT/UPDATE/DELETE on
--          order_items) re-SUMs every order_items row and writes
--          the result into orders.total_balance_remaining
--      => this path has always been correct.
--
--   2. admin_verify_payment() (migration 022, order_item_id IS
--      NULL — the whole-order payment / slip-upload flow) writes
--      DIRECTLY to orders.total_deposit_paid and orders.status,
--      and never touches order_items at all. Neither trigger above
--      fires, so orders.total_balance_remaining is NEVER
--      recalculated for this path — it's stuck at whatever it was
--      when the order was first created (i.e. the full total_amount),
--      no matter how much has actually been paid and verified since.
--
-- IMPACT: any order paid via the customer-facing whole-order slip
-- upload flow (the common case — see README_PAYMENT_FEATURE.md,
-- migration 019/021) shows a stale total_balance_remaining forever.
-- Any UI that gates the "ชำระเงิน" button on
-- balanceRemaining > 0 (my-trip page, payment page, admin order
-- detail — anywhere that reads this same column) keeps showing the
-- pay button after the customer has already paid in full, which is
-- exactly the confusing behavior reported.
--
-- FIX:
--   1. admin_verify_payment() now computes total_balance_remaining
--      the same way sync_order_totals already does for the other
--      path (total_amount - total_deposit_paid) and writes it in
--      the SAME UPDATE as total_deposit_paid/status, inside the
--      same row-locked transaction — no new race introduced.
--   2. One-off backfill UPDATE to correct every order currently
--      sitting on a stale value in production.
--
-- Safe to re-run (CREATE OR REPLACE; backfill UPDATE is idempotent
-- — a row already correct just doesn't match the WHERE clause a
-- second time).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_verify_payment(
  p_payment_id uuid,
  p_admin_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_amount numeric;
  v_total_amount numeric;
  v_deposit_required numeric;
  v_deposit_paid numeric;
  v_new_deposit_paid numeric;
  v_new_balance_remaining numeric;
  v_next_status text;
BEGIN
  -- Atomic claim (unchanged from migration 022).
  UPDATE public.payments
  SET status = 'verified', verified_by = p_admin_id, verified_at = now()
  WHERE id = p_payment_id
    AND order_item_id IS NULL
    AND status IN ('waiting_verification', 'pending')
  RETURNING order_id, amount INTO v_order_id, v_amount;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'payment_not_claimable';
  END IF;

  -- Row lock on the order (unchanged from migration 022) — now also
  -- reads total_amount, needed to (re)derive total_balance_remaining
  -- the same way sync_order_totals does for the order_items path.
  SELECT total_amount, total_deposit_required, total_deposit_paid
  INTO v_total_amount, v_deposit_required, v_deposit_paid
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  v_new_deposit_paid := COALESCE(v_deposit_paid, 0) + v_amount;

  -- Same formula sync_order_totals() uses for the order_items path:
  -- balance_remaining = amount owed - amount paid. Not floored at 0
  -- on purpose, for the same reason order_items.balance_remaining
  -- isn't floored either — an overpayment should be visible as a
  -- negative balance, not silently clamped to zero.
  v_new_balance_remaining := COALESCE(v_total_amount, 0) - v_new_deposit_paid;

  v_next_status := CASE
    WHEN COALESCE(v_deposit_required, 0) > 0 AND v_new_deposit_paid >= v_deposit_required THEN 'confirmed'
    ELSE 'deposit_paid'
  END;

  -- ⭐ THE FIX: total_balance_remaining is now part of this same
  -- UPDATE, inside the same row lock, instead of being silently
  -- skipped.
  UPDATE public.orders
  SET
    total_deposit_paid = v_new_deposit_paid,
    total_balance_remaining = v_new_balance_remaining,
    status = v_next_status
  WHERE id = v_order_id;

  RETURN json_build_object(
    'paymentId', p_payment_id,
    'orderId', v_order_id,
    'newDepositPaid', v_new_deposit_paid,
    'newBalanceRemaining', v_new_balance_remaining,
    'orderStatus', v_next_status
  );
END;
$$;

-- CREATE OR REPLACE does not preserve prior REVOKEs (see migration
-- 028's note on this exact footgun) — re-assert the full migration
-- 027 lockdown so this function doesn't silently reopen the
-- anon/authenticated EXECUTE hole.
REVOKE ALL ON FUNCTION public.admin_verify_payment(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_verify_payment(UUID, UUID)
  TO service_role;

-- ============================================================
-- Backfill: fix every order already sitting on a stale
-- total_balance_remaining because of the bug above. Only touches
-- rows where the stored value disagrees with the correct derived
-- value — orders that only ever went through
-- partner_verify_payment() (or never had any payment verified) are
-- already correct and this UPDATE is a no-op for them.
-- ============================================================

UPDATE public.orders
SET total_balance_remaining = total_amount - total_deposit_paid
WHERE total_balance_remaining IS DISTINCT FROM (total_amount - total_deposit_paid);

-- ------------------------------------------------------------
-- Verify after running — should return 0 rows:
--
--   select id, order_number, total_amount, total_deposit_paid,
--          total_balance_remaining
--   from public.orders
--   where total_balance_remaining is distinct from (total_amount - total_deposit_paid);
-- ------------------------------------------------------------
