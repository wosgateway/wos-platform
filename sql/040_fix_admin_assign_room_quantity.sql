-- ============================================================
-- MIGRATION 040: admin_assign_order_item() must multiply by
-- room_quantity for hotel items — it currently doesn't.
--
-- Context: migrations 028/036/037 store room_quantity on
-- order_items at customer-booking time and use it when pricing
-- hotel items in create_order_with_items(). But
-- admin_assign_order_item() (016/017/018, re-issued in 032, and
-- again in 038 for the is_active fix) never multiplies by it —
-- it only does v_price := ROUND(v_unit_price * p_quantity, 2).
--
-- Bug this closes: an admin assigning (or reassigning) a package
-- to a hotel order_item with room_quantity > 1 produces a price
-- (and therefore deposit_required, via v_rule.deposit_value % of
-- v_price) that is short by a factor of room_quantity. E.g. a
-- 3-room booking at 1,000/room prices as 1,000 instead of 3,000.
--
-- Approach: minimal patch on top of 038, same pattern 038 used
-- on top of 032. Every line below is byte-for-byte identical to
-- the live definition in migration 038, except:
--   1. v_price computation now branches on service_type = 'hotel'
--      and multiplies by COALESCE(v_row.room_quantity, 1) in that
--      branch only. clinic/wellness/transport are unaffected —
--      same v_price := ROUND(v_unit_price * p_quantity, 2) as
--      before.
--   2. The returned JSONB now also includes room_quantity so the
--      admin-assign API response reflects what was actually
--      charged, without requiring a refetch (flagged as optional
--      in review, included here since it's a one-line addition
--      alongside a price fix touching the same object).
--
-- Does NOT touch admin_update_order_item_schedule() — unaffected,
-- as noted in 038.
--
-- Do not edit sql/038_admin_assign_respects_package_is_active.sql
-- retroactively; it's already applied to production. This
-- migration supersedes only the price computation of
-- admin_assign_order_item() via a new CREATE OR REPLACE.
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
-- 028's header note, restated in 032/037/038) — re-assert the
-- lockdown every time this function is touched.
REVOKE ALL ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) TO service_role;
