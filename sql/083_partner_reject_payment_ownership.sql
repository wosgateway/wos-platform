-- ============================================================
-- MIGRATION 083: partner_reject_payment() — new RPC, closes the
-- defense-in-depth gap that partner_verify_payment() (migration 060)
-- already closed on the verify side.
--
-- FINDING:
--
--   /api/partner/payments/[id]/reject currently rejects a payment
--   with a plain UPDATE ... WHERE id = :paymentId, issued through the
--   SERVICE-ROLE client (bypasses RLS). The only thing standing
--   between that UPDATE and a cross-partner reject is an earlier
--   SELECT on `payments` done through the RLS-scoped client, relying
--   on the payments SELECT policy (migration 042) to 404 a payment
--   that isn't the caller's. That is exactly the "masked, not
--   closed" gap migration 060 documented for verify: the SELECT
--   pre-check is real, but there is no independent DB-level backstop
--   if that RLS policy is ever loosened or a future caller (new
--   route, admin script) skips the pre-check and calls straight
--   through with a service-role connection.
--
--   Verify already has that backstop (partner_verify_payment asserts
--   order_items.partner_id = p_partner_id under a row lock before
--   writing). Reject has never had an equivalent function, since the
--   original reject route was written as a raw UPDATE with no RPC at
--   all.
--
-- FIX: add partner_reject_payment(), same claim + ownership-check
-- shape as partner_verify_payment() — atomic claim via
-- UPDATE ... WHERE status IN (...), row lock on the order_item,
-- assert partner_id ownership, raise (and roll back the claim) on
-- mismatch. No balance/deposit_paid math needed here since a
-- rejected payment never counted toward it.
--
-- Run on staging first. Safe to re-run (DROP IF EXISTS + CREATE).
-- ============================================================

DROP FUNCTION IF EXISTS public.partner_reject_payment(UUID, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.partner_reject_payment(
  p_payment_id uuid,
  p_verified_by_user_id uuid,
  p_partner_id uuid,
  p_reason text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_item_id uuid;
  v_item_partner_id uuid;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason_required';
  end if;

  -- Atomic claim: only succeeds if the payment is still
  -- waiting_verification/pending at the moment this statement runs,
  -- same pattern as partner_verify_payment — a reject racing a
  -- verify (or another reject) on the same payment can't both
  -- appear to succeed.
  update public.payments
  set status = 'rejected',
      verified_by = p_verified_by_user_id,
      verified_at = now(),
      rejection_reason = p_reason
  where id = p_payment_id
    and order_item_id is not null
    and status in ('waiting_verification', 'pending')
  returning order_item_id into v_order_item_id;

  if v_order_item_id is null then
    raise exception 'payment_not_claimable';
  end if;

  -- Row lock on the order_item while we check ownership — mirrors
  -- partner_verify_payment's lock, even though reject doesn't write
  -- to order_items, so the ownership check reads a consistent row
  -- and can't race a concurrent reassignment of the item.
  select partner_id
  into v_item_partner_id
  from public.order_items
  where id = v_order_item_id
  for update;

  if not found then
    raise exception 'order_item_not_found';
  end if;

  -- Ownership check: the order_item this payment belongs to must
  -- belong to the partner the caller was authenticated as. This is
  -- the DB-level backstop the route's RLS pre-check was standing in
  -- for alone. Raising here rolls back the payments UPDATE above
  -- too, so a rejected claim isn't left half-applied on a payment
  -- that doesn't belong to this partner.
  if v_item_partner_id is distinct from p_partner_id then
    raise exception 'not_authorized';
  end if;

  return json_build_object(
    'paymentId', p_payment_id,
    'orderItemId', v_order_item_id
  );
end;
$$;

REVOKE ALL ON FUNCTION public.partner_reject_payment(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_reject_payment(UUID, UUID, UUID, TEXT)
  TO service_role;

-- ============================================================
-- VERIFY after running:
--
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'partner_reject_payment';
--   -- expect exactly one row, pronargs = 4
--
--   SELECT routine_name, grantee, privilege_type
--   FROM information_schema.role_routine_grants
--   WHERE routine_name = 'partner_reject_payment';
--   -- expect only service_role
--
-- Functional test (do AFTER deploying the route.ts fix in the same
-- delivery — the old route does a raw UPDATE and doesn't call this
-- RPC yet):
--   - Partner A rejects their own pending payment -> succeeds.
--   - Manually call the RPC with Partner A's user but Partner B's
--     order_item's payment_id and B's real partner_id spoofed as A's
--     -> 'not_authorized', payment stays unrejected.
--   - Reject an already-verified/rejected payment -> 'payment_not_claimable'.
--   - Reject with an empty/whitespace-only reason -> 'reason_required'.
-- ============================================================
