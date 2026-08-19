-- ============================================================
-- 022_atomic_payment_verify.sql
--
-- Fixes 2 remaining race conditions found in code review of
-- admin/payments/[id]/verify and partner/payments/[id]/verify:
--
--   1. Payment status transition (waiting_verification -> verified)
--      and the resulting order/order_item balance update were two
--      separate round-trips from the app. If the second one failed,
--      the payment was left "verified" with no balance to show for
--      it €” no way to retry (the payment no longer matches the
--      claimable statuses) and no way to detect the mismatch from
--      the API response alone.
--
--   2. Two DIFFERENT payments on the SAME order/order_item verified
--      at the same instant could both read the pre-update balance
--      and both write balance + amount, losing one of the two
--      increments (last write wins). Migration 021's partial unique
--      index only prevents a second *pending* whole-order payment €”
--      it doesn't serialize two already-distinct verifies.
--
-- Both are fixed by moving the claim + balance update into a single
-- Postgres function: the UPDATE ... WHERE status IN (...) claim and
-- the SELECT ... FOR UPDATE row lock on the parent order/order_item
-- both run inside the function's implicit transaction, so either
-- everything commits together or nothing does, and concurrent calls
-- against the same order/order_item serialize on the row lock instead
-- of racing.
--
-- Safe to re-run (CREATE OR REPLACE).
-- ============================================================

-- ------------------------------------------------------------
-- Admin verify: whole-order payments (order_item_id IS NULL)
-- ------------------------------------------------------------
create or replace function public.admin_verify_payment(
  p_payment_id uuid,
  p_admin_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_amount numeric;
  v_deposit_required numeric;
  v_deposit_paid numeric;
  v_calculated_deposit_paid numeric;
  v_next_status text;
begin
  -- 1. Atomically claim the payment.
  update public.payments
  set
    status = 'verified',
    verified_by = p_admin_id,
    verified_at = now()
  where id = p_payment_id
    and order_item_id is null
    and status in ('waiting_verification', 'pending')
  returning order_id, amount
  into v_order_id, v_amount;

  if v_order_id is null then
    raise exception 'payment_not_claimable';
  end if;

  -- 2. Lock the order row before calculating the new balance.
  select
    o.total_deposit_required,
    o.total_deposit_paid
  into
    v_deposit_required,
    v_deposit_paid
  from public.orders o
  where o.id = v_order_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  -- 3. Calculate the new amount using a variable name
  --    that cannot be confused with a column name.
  v_calculated_deposit_paid :=
    coalesce(v_deposit_paid, 0) + coalesce(v_amount, 0);

  -- 4. Determine the next order status.
  v_next_status :=
    case
      when coalesce(v_deposit_required, 0) > 0
       and v_calculated_deposit_paid >= v_deposit_required
        then 'confirmed'
      else 'deposit_paid'
    end;

  -- 5. Update the order atomically.
  update public.orders o
  set
    total_deposit_paid = v_calculated_deposit_paid,
    status = v_next_status
  where o.id = v_order_id;

  -- 6. Return result.
  return json_build_object(
    'paymentId', p_payment_id,
    'orderId', v_order_id,
    'newDepositPaid', v_calculated_deposit_paid,
    'orderStatus', v_next_status
  );
end;
$$;

grant execute on function public.admin_verify_payment(uuid, uuid)
to service_role;

-- ------------------------------------------------------------
-- Partner verify: order-item-scoped payments (order_item_id set)
-- ------------------------------------------------------------
create or replace function public.partner_verify_payment(
  p_payment_id uuid,
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
  v_remaining numeric;
  v_new_deposit_paid numeric;
begin
  update public.payments
  set status = 'verified', verified_by = p_partner_id, verified_at = now()
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
  select price, deposit_paid
  into v_price, v_deposit_paid
  from public.order_items
  where id = v_order_item_id
  for update;

  if not found then
    raise exception 'order_item_not_found';
  end if;

  v_remaining := coalesce(v_price, 0) - coalesce(v_deposit_paid, 0);

  if v_amount > v_remaining + 0.01 and not p_confirm_overpayment then
    raise exception 'amount_exceeds_balance';
  end if;

  v_new_deposit_paid := coalesce(v_deposit_paid, 0) + v_amount;

  update public.order_items
  set deposit_paid = v_new_deposit_paid
  where id = v_order_item_id;
  -- sync_order_item_balance / sync_order_totals triggers (referenced
  -- in the original route comment) still fire off this UPDATE as
  -- normal €” this function doesn't bypass them, it just makes the
  -- claim + write atomic with everything else above.

  return json_build_object(
    'paymentId', p_payment_id,
    'orderItemId', v_order_item_id,
    'newDepositPaid', v_new_deposit_paid,
    'remainingBeforeThis', v_remaining
  );
end;
$$;

grant execute on function public.partner_verify_payment(uuid, uuid, boolean) to service_role;
