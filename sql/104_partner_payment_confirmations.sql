-- ============================================================
-- 104_partner_payment_confirmations.sql
--
-- Phase 6 — a dedicated table for partners confirming receipt of
-- partner_balance directly from a customer, + repointing
-- partner_verify_payment at wos_booking_fee only
-- (wos_business_rules_lock.md ข้อ 7).
--
-- THE BUG THIS CLOSES (flagged since 102, deferred until now on
-- purpose — it needed partner_balance (102) and a real commission
-- base (103) to exist first, and needs its own migration because
-- it's a genuine behavior change to a live, money-moving RPC):
--
--   partner_verify_payment (022, ownership-hardened in 060) is how
--   partner staff confirm a `payments` row — created for ANY
--   order-item-scoped payment, regardless of payment_method
--   (one_bank_qr, bank_transfer, promptpay, cash_at_clinic,
--   cash_at_hotel; see 008) — and it has always rolled the full
--   amount into order_items.deposit_paid, capped only by `price`
--   (the FULL package price):
--
--     v_remaining := coalesce(v_price, 0) - coalesce(v_deposit_paid, 0);
--
--   deposit_paid is WOS's own ledger for how much of deposit_required
--   (wos_booking_fee) has been paid — it's what admin_verify_payment
--   (022), sync_order_item_balance, and sync_order_totals all read to
--   decide order status and balance_remaining. Capping a PARTNER's
--   own confirmation against the full `price` instead of
--   `deposit_required` means a partner confirming a customer's cash
--   payment for the FULL package (price, e.g. 100,000 — most of which
--   is partner_balance, e.g. 80,000, that never touches WOS at all)
--   can push deposit_paid past deposit_required (e.g. 20,000) and
--   make WOS's own booking-fee ledger say the fee is "overpaid," when
--   in fact WOS received none of that money — the partner did. This
--   is the exact mixing wos_business_rules_lock.md ข้อ 7 describes.
--
-- THE FIX — two independent pieces:
--
--   A. partner_verify_payment's ceiling changes from `price` to
--      `deposit_required`. After this, deposit_paid via this RPC can
--      never exceed the actual wos_booking_fee, regardless of how
--      large the underlying payment amount is — it is now, in fact,
--      "wos_booking_fee only." This is the minimal, one-value fix;
--      everything else about the function (claim, row lock, ownership
--      check from 060, overpayment escape hatch) is untouched.
--
--   B. A genuinely separate mechanism —
--      partner_payment_confirmations, + order_items.
--      partner_balance_confirmed, + a new
--      partner_confirm_balance_payment() RPC mirroring 060's
--      ownership/atomicity pattern exactly — for the money (A)
--      deliberately no longer accepts: a partner recording that they
--      personally received some or all of partner_balance directly
--      from the customer. This never touches `payments` or
--      deposit_paid at all — it's accounted for entirely on its own
--      axis, against partner_balance (102) as the ceiling, the same
--      way deposit_paid is accounted against deposit_required.
--
-- WHY A SEPARATE TABLE, NOT A NEW `payments.kind` COLUMN:
--   `payments` rows exist to be verified by whoever is meant to
--   RECEIVE that money — admin_verify_payment for WOS-bound rows,
--   partner_verify_payment (now correctly capped) for wos_booking_fee
--   rows a partner happens to collect on WOS's behalf. A partner
--   confirming they were personally paid isn't "verifying a payment
--   TO someone else," it's the partner attesting to money that
--   stopped in their own hands and never needs the pending ->
--   waiting_verification -> verified/rejected lifecycle `payments`
--   is built around (no slip upload, no possibility of a THIRD party
--   verifying it — the partner both received the money and makes the
--   only record of it). Reusing `payments` for this would mean
--   teaching admin_verify_payment/sync_order_item_balance to
--   recognize and skip a kind of row they should never affect —
--   riskier than a table that simply can't be reached by that code
--   at all.
--
-- WHY partner_balance_confirmed IS A REAL COLUMN, NOT DERIVED FROM
-- partner_balance:
--   partner_balance (102) is GENERATED (price - deposit_required) —
--   correct for "how much is structurally owed," but a payment-
--   progress figure ("how much of that has actually been confirmed
--   received") has no formula to generate it from; it can only be a
--   running total that mutates as confirmations come in. Same reason
--   deposit_paid isn't generated. Maintained by the RPC directly
--   (atomic increment under the same row lock), not a SUM trigger —
--   same pattern 022/060 already use for deposit_paid, kept for
--   consistency rather than introducing a second bookkeeping style.
--
-- NOT touched here, on purpose: the `payments` table itself, price/
-- deposit_required/deposit_paid/balance_remaining/partner_balance
-- (columns, not what writes to them), commission_amount/
-- commission_rate_snapshot (103), admin_verify_payment,
-- sync_order_item_balance, sync_order_totals. A "reject/void a
-- confirmation" flow (companion to 083's partner_reject_payment) is
-- also not included here — confirmations are additive-only for now;
-- add that as its own migration if a mis-recorded confirmation needs
-- to be walked back.
--
-- Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. order_items.partner_balance_confirmed — running total of
--    confirmed partner_balance receipts, mirrors deposit_paid's role
--    for the other money-bucket.
-- ------------------------------------------------------------
ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS partner_balance_confirmed NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.order_items.partner_balance_confirmed IS
    'wos_business_rules_lock.md ข้อ 7 — running total of partner_payment_confirmations.amount for this item: how much of partner_balance the partner has confirmed receiving directly from the customer. Payment-progress, not GENERATED (same reason deposit_paid isn''t) — maintained only by partner_confirm_balance_payment() (migration 104) under a row lock, never by application code directly. Not the same axis as deposit_paid: that tracks wos_booking_fee, this tracks partner_balance, and after migration 104 the two can never be conflated via a single RPC again.';

-- ------------------------------------------------------------
-- 2. partner_payment_confirmations — the record of each individual
--    confirmation (kept even though order_items only needs the
--    running total, for the same reason `payments` isn't collapsed
--    into a single number on `orders`: an audit trail per partner,
--    per item, per confirming staff member).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_payment_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,

    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL DEFAULT 'cash_at_clinic',
    reference TEXT,

    confirmed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_partner_confirmation_method CHECK (payment_method IN (
        'cash_at_clinic', 'cash_at_hotel', 'bank_transfer', 'other'
    ))
);

CREATE INDEX IF NOT EXISTS idx_partner_payment_confirmations_order_item_id
    ON public.partner_payment_confirmations(order_item_id);
CREATE INDEX IF NOT EXISTS idx_partner_payment_confirmations_partner_id
    ON public.partner_payment_confirmations(partner_id);

COMMENT ON TABLE public.partner_payment_confirmations IS
    'wos_business_rules_lock.md ข้อ 7 / Phase 6 — a partner attesting they personally received money from a customer toward partner_balance (order_items.price - deposit_required). Deliberately NOT the `payments` table: no verification lifecycle, no third-party verifier — the partner both receives the money and makes the only record of it. Written only by partner_confirm_balance_payment(), which also increments order_items.partner_balance_confirmed under the same row lock.';

-- ------------------------------------------------------------
-- 3. partner_confirm_balance_payment — atomic claim + ownership
--    check + write, same shape as partner_verify_payment (060), but
--    against partner_balance/partner_balance_confirmed instead of
--    `payments`/deposit_paid, and with no separate "claim" step
--    (there is no existing row to claim — the confirmation and the
--    row it creates are the same action).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_confirm_balance_payment(
    p_order_item_id uuid,
    p_confirmed_by_user_id uuid,
    p_partner_id uuid,
    p_amount numeric,
    p_payment_method text DEFAULT 'cash_at_clinic',
    p_reference text DEFAULT NULL,
    p_confirm_overpayment boolean DEFAULT false
    -- NOTE (post-review fix, before this migration ever ran): this
    -- parameter is accepted for call-site compatibility with the
    -- verify_payment family's signature shape, but is NOT honored
    -- below. partner_balance_confirmed <= partner_balance is a hard
    -- invariant — see the check below and this migration's header
    -- for why silently truncating or silently allowing the excess
    -- through is worse than rejecting outright.
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item_partner_id uuid;
    v_partner_balance numeric;
    v_confirmed numeric;
    v_remaining numeric;
    v_new_confirmed numeric;
    v_confirmation_id uuid;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'invalid_amount';
    END IF;

    -- Row lock on the order_item — same purpose as 060's lock on
    -- partner_verify_payment: two concurrent confirmations on the
    -- same item serialize on this instead of racing on
    -- partner_balance_confirmed.
    SELECT partner_id, partner_balance, partner_balance_confirmed
    INTO v_item_partner_id, v_partner_balance, v_confirmed
    FROM public.order_items
    WHERE id = p_order_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order_item_not_found';
    END IF;

    -- Ownership check — identical purpose and shape to 060's fix for
    -- partner_verify_payment. This function is SECURITY DEFINER and
    -- meant to be called via the service-role client (see the
    -- accompanying route), so it cannot resolve the caller's partner
    -- scope itself; the caller must pass the authenticated partner_id
    -- explicitly, never from client-supplied input.
    IF v_item_partner_id IS DISTINCT FROM p_partner_id THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;

    IF v_partner_balance IS NULL THEN
        -- Unassigned ("let team decide") item — 102/103 both leave
        -- partner_balance NULL for these on purpose. Nothing is owed
        -- to any partner yet, so there is nothing to confirm receipt
        -- of.
        RAISE EXCEPTION 'item_not_assigned';
    END IF;

    v_remaining := v_partner_balance - v_confirmed;

    -- Hard invariant, no override: partner_balance_confirmed can
    -- never exceed partner_balance through this function, regardless
    -- of p_confirm_overpayment. If a customer genuinely paid the
    -- partner more than partner_balance, that's a reconciliation
    -- problem (refund, or a corrected assignment/price), not a number
    -- this RPC should let past the ceiling — see this migration's
    -- header for the reasoning (post-review fix; the original draft
    -- let this parameter bypass the ceiling, which is exactly the
    -- kind of silent-drift 104 exists to prevent).
    IF p_amount > v_remaining + 0.01 THEN
        RAISE EXCEPTION 'amount_exceeds_balance';
    END IF;

    v_new_confirmed := v_confirmed + p_amount;

    UPDATE public.order_items
    SET partner_balance_confirmed = v_new_confirmed
    WHERE id = p_order_item_id;

    INSERT INTO public.partner_payment_confirmations (
        order_item_id, partner_id, amount, payment_method, reference, confirmed_by
    ) VALUES (
        p_order_item_id, p_partner_id, p_amount, COALESCE(p_payment_method, 'cash_at_clinic'), p_reference, p_confirmed_by_user_id
    )
    RETURNING id INTO v_confirmation_id;

    RETURN json_build_object(
        'confirmationId', v_confirmation_id,
        'orderItemId', p_order_item_id,
        'newPartnerBalanceConfirmed', v_new_confirmed,
        'remainingBeforeThis', v_remaining
    );
END;
$$;

REVOKE ALL ON FUNCTION public.partner_confirm_balance_payment(UUID, UUID, UUID, NUMERIC, TEXT, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_confirm_balance_payment(UUID, UUID, UUID, NUMERIC, TEXT, TEXT, BOOLEAN)
    TO service_role;

-- ------------------------------------------------------------
-- 4. Repoint partner_verify_payment at wos_booking_fee only.
--    Signature (4 args, from migration 060) is unchanged — CREATE OR
--    REPLACE, not DROP + CREATE, so no route/grant changes needed
--    beyond what's already in place.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_verify_payment(
  p_payment_id uuid,
  p_verified_by_user_id uuid,
  p_partner_id uuid,
  p_confirm_overpayment boolean default false
  -- NOTE (post-review fix, before this migration ever ran): this
  -- parameter existed in 022/060 as a genuine override — with the
  -- ceiling now deposit_required instead of price, honoring it here
  -- would let a partner's own confirmation push WOS's booking-fee
  -- ledger past the actual fee, which is precisely the ข้อ 7 bug this
  -- migration exists to close. Kept in the signature (no call-site
  -- changes needed) but no longer honored — see the check below.
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_item_id uuid;
  v_amount numeric;
  v_deposit_required numeric;
  v_deposit_paid numeric;
  v_item_partner_id uuid;
  v_remaining numeric;
  v_new_deposit_paid numeric;
BEGIN
  UPDATE public.payments
  SET status = 'verified', verified_by = p_verified_by_user_id, verified_at = now()
  WHERE id = p_payment_id
    AND order_item_id IS NOT NULL
    AND status IN ('waiting_verification', 'pending')
  RETURNING order_item_id, amount INTO v_order_item_id, v_amount;

  IF v_order_item_id IS NULL THEN
    RAISE EXCEPTION 'payment_not_claimable';
  END IF;

  -- Changed from `SELECT price, deposit_paid, partner_id` (022/060):
  -- deposit_required replaces price as the ceiling this RPC checks
  -- against — see this migration's header, point A.
  SELECT deposit_required, deposit_paid, partner_id
  INTO v_deposit_required, v_deposit_paid, v_item_partner_id
  FROM public.order_items
  WHERE id = v_order_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_item_not_found';
  END IF;

  IF v_item_partner_id IS DISTINCT FROM p_partner_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Changed from `coalesce(v_price, 0) - coalesce(v_deposit_paid, 0)`
  -- — see this migration's header, point A. This is the one-value fix
  -- that makes the function's name true: deposit_paid via this path
  -- can no longer exceed deposit_required (wos_booking_fee), no
  -- matter how large the underlying payment amount is.
  v_remaining := coalesce(v_deposit_required, 0) - coalesce(v_deposit_paid, 0);

  -- Hard invariant, no override: deposit_paid can never exceed
  -- deposit_required through this function. A payment amount larger
  -- than what's left of the WOS booking fee is, by definition, partly
  -- or wholly partner money — it belongs through
  -- partner_confirm_balance_payment() instead, not truncated in here
  -- silently and not let through via p_confirm_overpayment (which
  -- this migration stops honoring — see the parameter's comment
  -- above).
  IF v_amount > v_remaining + 0.01 THEN
    RAISE EXCEPTION 'amount_exceeds_balance';
  END IF;

  v_new_deposit_paid := coalesce(v_deposit_paid, 0) + v_amount;

  UPDATE public.order_items
  SET deposit_paid = v_new_deposit_paid
  WHERE id = v_order_item_id;

  RETURN json_build_object(
    'paymentId', p_payment_id,
    'orderItemId', v_order_item_id,
    'newDepositPaid', v_new_deposit_paid,
    'remainingBeforeThis', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.partner_verify_payment(UUID, UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_verify_payment(UUID, UUID, UUID, BOOLEAN)
  TO service_role;

COMMIT;

-- ============================================================
-- BEHAVIOR CHANGE WARNING — read before deploying:
--
-- Any payment a partner tries to verify via partner_verify_payment
-- where the amount is for the FULL price (or anything past
-- deposit_required) will now hit `amount_exceeds_balance` where it
-- previously succeeded — and, after the post-review fix above, this
-- can no longer be bypassed with confirmOverpayment either. That is
-- the fix working as intended — those payments were never
-- wos_booking_fee to begin with — but it means partner staff
-- currently in the habit of confirming full-price cash payments
-- through the existing "verify payment" flow will start seeing hard
-- rejections after this ships, with no override, until staff are
-- told to use the new balance-confirmation flow for anything beyond
-- the booking fee.
--
-- APP CHANGES — delivered alongside this migration, not left as a
-- follow-up:
--
--   1. src/app/api/partner/payments/[id]/verify/route.ts — now
--      selects deposit_required alongside price/deposit_paid and
--      computes the 'amount_exceeds_balance' message as
--      deposit_required - deposit_paid (matching what the RPC
--      actually enforces). Its message no longer offers
--      confirmOverpayment as a way through, since the RPC no longer
--      honors it — the message instead points at the balance-
--      confirmation flow for the excess.
--
--   2. New route src/app/api/partner/payments/confirm-balance/
--      route.ts, calling partner_confirm_balance_payment with the
--      same auth/ownership shape as verify/route.ts. Its own
--      'amount_exceeds_balance' message is written the same way —
--      no override offered, since the RPC hard-rejects.
--
-- STILL NOT DONE (genuinely deferred, not part of this migration):
--
--   3. Partner-portal UI: a way for staff to actually reach the new
--      route (a "confirm balance received" action on the order_item
--      detail view, likely next to the existing verify/reject payment
--      actions), and somewhere to show partner_balance_confirmed vs.
--      partner_balance so staff can see how much is left.
--
-- Sanity checks after applying:
--
--   1. Hard invariant — deposit_paid never exceeds deposit_required,
--      for every order_item, no exceptions:
--     SELECT id, deposit_required, deposit_paid FROM public.order_items
--     WHERE deposit_paid > coalesce(deposit_required, 0) + 0.01;
--     -- expect 0 rows (any pre-existing violation predates this
--     -- migration and needs manual reconciliation — this migration
--     -- only guarantees no NEW violations can be created through
--     -- partner_verify_payment going forward)
--
--   2. Hard invariant — partner_balance_confirmed never exceeds
--      partner_balance:
--     SELECT id, partner_balance, partner_balance_confirmed FROM public.order_items
--     WHERE partner_balance_confirmed > coalesce(partner_balance, 0) + 0.01;
--     -- expect 0 rows
--
--   3. Existing order_items all start with partner_balance_confirmed
--      = 0, not NULL, even for unassigned items:
--     SELECT count(*) FROM public.order_items
--     WHERE partner_balance_confirmed IS NULL;
--     -- expect 0
--
--   4. partner_payment_confirmations.amount always sums to the
--      owning order_item's partner_balance_confirmed:
--     SELECT oi.id FROM public.order_items oi
--     WHERE oi.partner_balance_confirmed IS DISTINCT FROM (
--       SELECT COALESCE(SUM(ppc.amount), 0)
--       FROM public.partner_payment_confirmations ppc
--       WHERE ppc.order_item_id = oi.id
--     );
--     -- expect 0 rows
-- ============================================================
