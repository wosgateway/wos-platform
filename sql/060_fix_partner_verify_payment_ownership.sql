-- ============================================================
-- MIGRATION 060: partner_verify_payment() — enforce ownership,
-- fix misnamed parameter.
--
-- FINDINGS (Security Audit STEP 2 / STEP 4, checkpoint items #1 and #5):
--
--   1. partner_verify_payment() (migration 022) never checks that the
--      order_item it's verifying a payment against actually belongs
--      to the calling partner. It claims the payment (status ->
--      verified) and rolls the amount into order_items.deposit_paid
--      purely by payment_id, with no partner-scope predicate anywhere
--      in the function body.
--
--      Today this is masked, not closed: the route
--      (src/app/api/partner/payments/[id]/verify/route.ts) does a
--      SELECT through the RLS-scoped client first, and payments RLS
--      (migration 042) filters to the caller's own partner_id — so a
--      payment belonging to another partner returns 404 before the
--      RPC is ever called. But the RPC itself is invoked via the
--      SERVICE-ROLE client (bypasses RLS entirely) and is a
--      SECURITY DEFINER function — so it has no defense-in-depth of
--      its own. Any future caller of this function (a new route, an
--      admin script, a bug in the pre-check) has no DB-level backstop
--      preventing cross-partner payment verification.
--
--   2. The existing `p_partner_id` parameter is misnamed: the route
--      actually passes `user.id` (the staff user's own id) into it,
--      and the function only ever uses it to stamp
--      `payments.verified_by` — an audit field, not an authorization
--      scope. There has never been a real partner-scope check in this
--      function. Renamed to `p_verified_by_user_id` to match what it
--      actually is.
--
-- FIX: add a genuine `p_partner_id` parameter — the caller's real
-- partner scope, i.e. `partners.id` via branches.partner_id (the same
-- value order_items.partner_id is compared against everywhere else,
-- see migration 010/042) — and assert
-- `order_items.partner_id = p_partner_id` under the same row lock
-- used for the balance check, right after claiming the payment and
-- before touching deposit_paid. On mismatch, roll back via exception
-- (payments.status update is not committed) instead of silently
-- succeeding.
--
-- NOTE: this function is called through the service-role client (see
-- route.ts), so it cannot resolve scope itself via
-- current_user_partner_id() (that helper reads auth.uid(), which is
-- not set on a service-role connection) — the caller MUST pass the
-- correct partner_id explicitly. The companion route.ts fix (in the
-- same delivery as this migration) sources it from
-- `user.branch.partner_id`, never from client-supplied input.
--
-- Signature changes from (uuid, uuid, boolean) to
-- (uuid, uuid, uuid, boolean) — old signature is dropped explicitly
-- since Postgres treats a different arg list as a distinct overload
-- and would otherwise leave the old, unguarded version callable.
--
-- Run on staging first. Safe to re-run (DROP IF EXISTS + CREATE).
-- ============================================================

DROP FUNCTION IF EXISTS public.partner_verify_payment(UUID, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.partner_verify_payment(
  p_payment_id uuid,
  p_verified_by_user_id uuid,
  p_partner_id uuid,
  p_confirm_overpayment boolean default false
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_item_id uuid;
  v_amount numeric;
  v_price numeric;
  v_deposit_paid numeric;
  v_item_partner_id uuid;
  v_remaining numeric;
  v_new_deposit_paid numeric;
begin
  update public.payments
  set status = 'verified', verified_by = p_verified_by_user_id, verified_at = now()
  where id = p_payment_id
    and order_item_id is not null
    and status in ('waiting_verification', 'pending')
  returning order_item_id, amount into v_order_item_id, v_amount;

  if v_order_item_id is null then
    raise exception 'payment_not_claimable';
  end if;

  -- Row lock on the order_item: a concurrent verify of another
  -- payment on the same item blocks here instead of racing on
  -- deposit_paid.
  select price, deposit_paid, partner_id
  into v_price, v_deposit_paid, v_item_partner_id
  from public.order_items
  where id = v_order_item_id
  for update;

  if not found then
    raise exception 'order_item_not_found';
  end if;

  -- Ownership check (new): the order_item this payment rolls up into
  -- must belong to the partner the caller was authenticated as. This
  -- is the DB-level backstop the route's RLS pre-check was standing
  -- in for alone. Raising here rolls back the payments UPDATE above
  -- too, so a rejected claim isn't left half-applied.
  if v_item_partner_id is distinct from p_partner_id then
    raise exception 'not_authorized';
  end if;

  v_remaining := coalesce(v_price, 0) - coalesce(v_deposit_paid, 0);

  if v_amount > v_remaining + 0.01 and not p_confirm_overpayment then
    raise exception 'amount_exceeds_balance';
  end if;

  v_new_deposit_paid := coalesce(v_deposit_paid, 0) + v_amount;

  update public.order_items
  set deposit_paid = v_new_deposit_paid
  where id = v_order_item_id;
  -- sync_order_item_balance / sync_order_totals triggers still fire
  -- off this UPDATE as normal — this function doesn't bypass them, it
  -- just makes the claim + ownership check + write atomic with
  -- everything else above.

  return json_build_object(
    'paymentId', p_payment_id,
    'orderItemId', v_order_item_id,
    'newDepositPaid', v_new_deposit_paid,
    'remainingBeforeThis', v_remaining
  );
end;
$$;

REVOKE ALL ON FUNCTION public.partner_verify_payment(UUID, UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_verify_payment(UUID, UUID, UUID, BOOLEAN)
  TO service_role;

-- ============================================================
-- VERIFY after running:
--
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'partner_verify_payment';
--   -- expect exactly one row, pronargs = 4
--
--   SELECT routine_name, grantee, privilege_type
--   FROM information_schema.role_routine_grants
--   WHERE routine_name = 'partner_verify_payment';
--   -- expect only service_role
--
-- Then functional test (do AFTER deploying the route.ts fix in the
-- same delivery — the old route still calls the 3-arg signature and
-- will break until it's updated to pass p_partner_id):
--   - Partner A verifies their own pending payment -> succeeds.
--   - Manually call the RPC with Partner A's user but Partner B's
--     order_item's payment_id and B's real partner_id spoofed as A's
--     -> 'not_authorized', payment stays unverified (was previously
--     the untested gap — STEP 7 test list, add this case).
-- ============================================================
