-- ============================================================
-- MIGRATION 016: admin_assign_order_item() — lets an admin resolve
-- a "let team decide" order_items row (needs_assignment = true,
-- from migration 013/014) into a fully priced, partnered row, using
-- the exact same price/deposit derivation as
-- create_order_with_items() (migration 014) so there's only one
-- place that logic lives.
--
-- Guards:
--   - row must currently have needs_assignment = true (can't
--     re-assign an already-resolved row through this path — that's
--     an edit, a different and riskier operation, not in scope here)
--   - the package's partner category must map to the SAME
--     service_type the row was created with (hotel stays hotel,
--     transport stays transport) — stops an admin from accidentally
--     assigning a clinic package onto a hotel line item
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
BEGIN
    SELECT * INTO v_row FROM public.order_items WHERE id = p_order_item_id;
    IF v_row IS NULL THEN
        RAISE EXCEPTION 'order_item % not found', p_order_item_id;
    END IF;
    IF v_row.needs_assignment IS NOT TRUE THEN
        RAISE EXCEPTION 'order_item % is already assigned', p_order_item_id;
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
        'deposit_required', v_deposit
    );
END;
$$;

-- Called from the admin API route via the service-role client — the
-- admin's own session is verified in Next.js (see
-- lib/admin/require-admin.ts) *before* this is called, same
-- division of responsibility as create_order_with_items().
REVOKE ALL ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) TO service_role;
