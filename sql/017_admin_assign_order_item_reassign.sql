-- ============================================================
-- MIGRATION 017: admin_assign_order_item() — allow reassignment of
-- hotel/transport add-on items from the orders list ("เปลี่ยน
-- แพ็กเกจ" dropdown in BookingsManager.tsx), which migration 016
-- explicitly left out of scope.
--
-- Original guard (016): only allowed when needs_assignment = true
-- (first-time assignment from the pending-assignments screen).
-- Any call on an already-resolved row raised "already assigned".
--
-- New behavior:
--   - First assignment (needs_assignment = true): unchanged, same
--     as migration 016.
--   - Reassignment (needs_assignment = false): now allowed, but
--     ONLY for service_type IN ('hotel', 'transport') — these are
--     add-ons an admin routinely swaps (e.g. wrong hotel picked,
--     partner unavailable). Reassigning a clinic/wellness/insurance
--     item is still blocked here; that touches the patient's core
--     medical program and stays a manual/DB-level operation.
--   - Reassignment is blocked outright if deposit_paid > 0 for that
--     item — per product decision, a paid deposit must be
--     cancelled/refunded before the package can be changed, rather
--     than silently recalculating balance_remaining under it.
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
        -- Reassigning an already-resolved row: only in scope for
        -- hotel/transport add-ons.
        IF v_row.service_type NOT IN ('hotel', 'transport') THEN
            RAISE EXCEPTION
                'order_item % is already assigned and reassignment via this path is only supported for hotel/transport items (got service_type=%)',
                p_order_item_id, v_row.service_type;
        END IF;

        -- A paid deposit must be cancelled/refunded before the
        -- package can change — never silently recompute balance
        -- under a payment that was collected against the old price.
        IF COALESCE(v_row.deposit_paid, 0) > 0 THEN
            RAISE EXCEPTION
                'cannot reassign order_item %: deposit already paid (%), cancel/refund it before changing the package',
                p_order_item_id, v_row.deposit_paid;
        END IF;
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'quantity must be positive';
    END IF;

    SELECT * INTO v_pkg FROM public.packages
    WHERE id = p_package_id AND status = 'published';
    IF v_pkg IS NULL THEN
        RAISE EXCEPTION 'unknown or unpublished package_id %', p_package_id;
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
    v_price := ROUND(v_unit_price * p_quantity, 2);

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
        'was_reassignment', v_is_reassignment
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) TO service_role;
