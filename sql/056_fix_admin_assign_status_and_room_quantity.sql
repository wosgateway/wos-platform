-- ============================================================
-- MIGRATION 056: admin_assign_order_item() — two fixes found while
-- debugging BookingsManager.reassignItem() 500s in production.
--
-- FIX 1 — status whitelist gap (live bug, currently blocking admins):
--
--   Migration 018 introduced the reassignment status guard, allowing
--   reassignment only while orders.status IN ('draft',
--   'pending_deposit', 'deposit_paid'). Migration 020b added
--   'pending_verification' to orders.status *after* 018 shipped, and
--   nothing ever added it to this whitelist. Result: as soon as a
--   customer submits a payment slip (order moves to
--   pending_verification, migration 021), hotel/transport
--   reassignment starts throwing:
--
--     "cannot reassign order_item %: parent order status is
--      pending_verification — package is locked once confirmed,
--      cancel/refund instead"
--
--   ...even though the order is NOT confirmed and no deposit has
--   been verified yet. This is a merge gap between two migrations,
--   not an intentional lock. pending_verification means "slip
--   uploaded, awaiting admin review" — nothing has been committed on
--   the partner side yet, so it belongs in the same allowed set as
--   pending_deposit/deposit_paid. Once an admin actually verifies
--   the payment (order -> confirmed, migration 022), the existing
--   lock still applies as before.
--
-- FIX 2 — room_quantity double-multiplication (silent pricing bug):
--
--   Migration 040 made this function multiply hotel prices by
--   v_row.room_quantity internally. But
--   src/app/api/admin/order-items/[id]/assign/route.ts (predates
--   040, comment there is now stale) ALSO folds room_quantity into
--   p_quantity before calling this RPC:
--     combinedQuantity = nightsOrDays * roomQuantity
--   Since 040 shipped, every hotel assignment/reassignment with
--   room_quantity > 1 has been priced (and deposited) at
--   room_quantity² instead of room_quantity. This migration does NOT
--   change SQL for that — the fix is entirely in route.ts (see
--   accompanying code change) which now sends p_quantity = nights
--   only and lets this function own the room_quantity multiply, as
--   040 intended. Noted here so the two migrations that touch this
--   function read as one debugging session, not two unrelated ones.
--
-- Every line below is byte-for-byte identical to the live definition
-- in migration 040, except the status whitelist in the reassignment
-- guard now also accepts 'pending_verification'.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_assign_order_item(
    p_order_item_id UUID,
    p_package_id UUID,
    p_quantity NUMERIC DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row RECORD;
    v_order_status TEXT;
    v_pkg RECORD;
    v_partner RECORD;
    v_rule RECORD;
    v_service_type TEXT;
    v_unit_price NUMERIC(12,2);
    v_price NUMERIC(12,2);
    v_deposit NUMERIC(12,2);
    v_is_reassignment BOOLEAN;
BEGIN
    SELECT * INTO v_row FROM public.order_items WHERE id = p_order_item_id;
    IF v_row IS NULL THEN
        RAISE EXCEPTION 'order_item % not found', p_order_item_id;
    END IF;

    v_is_reassignment := (v_row.needs_assignment IS NOT TRUE);

    IF v_is_reassignment THEN
        IF v_row.service_type NOT IN ('hotel', 'transport') THEN
            RAISE EXCEPTION
                'order_item % is already assigned and reassignment via this path is only supported for hotel/transport items (got service_type=%)',
                p_order_item_id, v_row.service_type;
        END IF;

        SELECT status INTO v_order_status FROM public.orders WHERE id = v_row.order_id;

        -- FIX 1: 'pending_verification' added — slip submitted but not
        -- yet reviewed is not a locked state (see header note).
        IF v_order_status IS DISTINCT FROM 'draft'
           AND v_order_status IS DISTINCT FROM 'pending_deposit'
           AND v_order_status IS DISTINCT FROM 'pending_verification'
           AND v_order_status IS DISTINCT FROM 'deposit_paid' THEN
            RAISE EXCEPTION
                'cannot reassign order_item %: parent order status is % — package is locked once confirmed, cancel/refund instead',
                p_order_item_id, v_order_status;
        END IF;
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'quantity must be positive';
    END IF;

    SELECT * INTO v_pkg FROM public.packages
    WHERE id = p_package_id
      AND status = 'published'
      AND is_active = true;
    IF v_pkg IS NULL THEN
        RAISE EXCEPTION 'unknown, unpublished, or inactive package_id %', p_package_id;
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

    IF v_service_type IS DISTINCT FROM v_row.service_type THEN
        RAISE EXCEPTION 'category mismatch: order_item is % but package resolves to %',
            v_row.service_type, v_service_type;
    END IF;

    v_unit_price := COALESCE(v_pkg.special_price, v_pkg.original_price);

    IF v_service_type = 'hotel' THEN
        v_price := ROUND(
            v_unit_price
            * p_quantity
            * COALESCE(v_row.room_quantity, 1),
            2
        );
    ELSE
        v_price := ROUND(
            v_unit_price * p_quantity,
            2
        );
    END IF;

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

    UPDATE public.order_items SET
        package_id = v_pkg.id,
        partner_id = v_partner.id,
        price = v_price,
        deposit_required = v_deposit,
        deposit_rule_id = v_rule.id,
        balance_remaining = v_price - COALESCE(deposit_paid, 0),
        needs_assignment = false
    WHERE id = p_order_item_id;

    RETURN jsonb_build_object(
        'order_item_id', p_order_item_id,
        'package_id', v_pkg.id,
        'partner_id', v_partner.id,
        'price', v_price,
        'deposit_required', v_deposit,
        'was_reassignment', v_is_reassignment,
        'room_quantity', COALESCE(v_row.room_quantity, 1)
    );
END;
$$;

-- CREATE OR REPLACE does not preserve prior REVOKEs (see migration
-- 028's header note, restated in 032/037/038/040) — re-assert the
-- lockdown every time this function is touched.
REVOKE ALL ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) TO service_role;
