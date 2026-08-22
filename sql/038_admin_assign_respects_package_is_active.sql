-- ============================================================
-- MIGRATION 038: admin_assign_order_item() must also respect
-- packages.is_active — closes the gap flagged (but deliberately
-- NOT fixed) in migration 037's header note.
--
-- Context: migration 037 fixed create_order_with_items()'s package
-- lookup to check `is_active = true` alongside `status = 'published'`,
-- but explicitly called out that the same gap still existed in
-- admin_assign_order_item() (migrations 016/017/018, re-issued
-- byte-for-byte in 032 for an unrelated em-dash encoding fix) and
-- deferred it to a follow-up migration. This is that follow-up.
--
-- Bug this closes: a package with status='published' but
-- is_active=false could not be selected by a customer (037), but
-- COULD still be assigned to an order_item by an admin via
-- admin_assign_order_item(), because that function's package lookup
-- only checked status = 'published'. That's a real business-rule
-- inconsistency, not theoretical — admin assignment is a live path.
--
-- Approach: minimal patch, not a rewrite. admin_assign_order_item()
-- carries substantial business logic (reassignment guard, order
-- status lock, quantity validation, partner/service_type resolution,
-- deposit_rule lookup, price/deposit computation, balance_remaining
-- update). Re-deriving this function from scratch risks silently
-- changing behavior that has nothing to do with is_active. Every
-- line below is byte-for-byte identical to the live definition in
-- migration 032, except:
--   1. The package lookup now also requires is_active = true.
--   2. The "unknown or unpublished package_id" error message is
--      updated to "unknown, unpublished, or inactive package_id"
--      so admins aren't told a real, published package doesn't
--      exist when the actual reason is is_active = false.
--
-- Does NOT touch admin_update_order_item_schedule() — that function
-- doesn't look up packages at all, so it isn't affected by this gap.
--
-- Do not edit sql/032_fix_corrupted_error_messages.sql retroactively;
-- it's already applied to production. This migration supersedes only
-- the package-lookup behavior of admin_assign_order_item() via a new
-- CREATE OR REPLACE, same pattern 032 itself used against 018.
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

        IF v_order_status IS DISTINCT FROM 'draft'
           AND v_order_status IS DISTINCT FROM 'pending_deposit'
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

-- CREATE OR REPLACE does not preserve prior REVOKEs (see migration
-- 028's header note, restated in 032 and 037) — re-assert the
-- lockdown every time this function is touched.
REVOKE ALL ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) TO service_role;
