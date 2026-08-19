-- ============================================================
-- MIGRATION 032: fix mojibake-corrupted em-dash in RAISE EXCEPTION
-- messages that are live in production right now.
--
-- Root cause: at some point the .sql files for migrations 018 and
-- 026 were saved/re-saved with a UTF-8 -> Latin-1 -> UTF-8 double
-- encoding pass. Pure ASCII text was unaffected, but every em-dash
-- (—, U+2014) inside those files was mangled into the 3-character
-- sequence "€”". Both migrations were already applied to production
-- before this was caught, so the two admin-facing RAISE EXCEPTION
-- messages below are currently shown to admins with garbled text
-- instead of a real em-dash.
--
-- This migration does NOT change any logic, guard conditions, or
-- function signatures — it only re-issues CREATE OR REPLACE with
-- the corrected string literals. Every other line is byte-for-byte
-- identical to the live 018 / 026 definitions.
--
-- Affected functions:
--   - public.admin_assign_order_item()        (from migration 018)
--   - public.admin_update_order_item_schedule() (from migration 026)
--
-- Note: this migration file itself contains real em-dash characters
-- (—) intentionally, saved as plain UTF-8. If you see "€”" anywhere
-- in this file after saving/copying it, the encoding got corrupted
-- again in transit — re-copy from the source instead of re-typing.
--
-- Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- admin_assign_order_item() — unchanged from migration 018 except
-- for the corrected em-dash in the "cannot reassign" message.
-- ------------------------------------------------------------
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

-- CREATE OR REPLACE does not preserve prior REVOKEs (see migration
-- 028's header note on the same footgun) — re-assert the lockdown.
REVOKE ALL ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_order_item(UUID, UUID, NUMERIC) TO service_role;

-- ------------------------------------------------------------
-- admin_update_order_item_schedule() — unchanged from migration 026
-- except for the corrected em-dash in the "cannot edit schedule"
-- (parent order locked) message.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_order_item_schedule(
    p_order_item_id UUID,
    p_admin_id UUID,
    p_scheduled_date DATE,
    p_scheduled_time TIME,
    p_hotel_checkout_date DATE,
    p_transport_return_date DATE,
    p_transport_return_time TIME,
    p_pickup_location TEXT,
    p_dropoff_location TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row RECORD;
    v_order_status TEXT;
    v_before JSONB;
    v_after JSONB;
BEGIN
    SELECT * INTO v_row FROM public.order_items WHERE id = p_order_item_id FOR UPDATE;
    IF v_row IS NULL THEN
        RAISE EXCEPTION 'order_item % not found', p_order_item_id;
    END IF;

    IF v_row.service_type NOT IN ('hotel', 'transport') THEN
        RAISE EXCEPTION
            'schedule editing via this path is only supported for hotel/transport items (got service_type=%)',
            v_row.service_type;
    END IF;

    IF v_row.status IN ('cancelled', 'refunded') THEN
        RAISE EXCEPTION
            'cannot edit schedule for order_item %: item status is %',
            p_order_item_id, v_row.status;
    END IF;

    SELECT status INTO v_order_status FROM public.orders WHERE id = v_row.order_id FOR UPDATE;

    IF v_order_status IS DISTINCT FROM 'draft'
       AND v_order_status IS DISTINCT FROM 'pending_deposit'
       AND v_order_status IS DISTINCT FROM 'deposit_paid' THEN
        RAISE EXCEPTION
            'cannot edit schedule for order_item %: parent order status is % — schedule is locked once confirmed',
            p_order_item_id, v_order_status;
    END IF;

    v_before := jsonb_build_object(
        'scheduled_date', v_row.scheduled_date,
        'scheduled_time', v_row.scheduled_time,
        'hotel_checkout_date', v_row.hotel_checkout_date,
        'transport_return_date', v_row.transport_return_date,
        'transport_return_time', v_row.transport_return_time,
        'pickup_location', v_row.pickup_location,
        'dropoff_location', v_row.dropoff_location
    );

    v_after := jsonb_build_object(
        'scheduled_date', p_scheduled_date,
        'scheduled_time', p_scheduled_time,
        'hotel_checkout_date', p_hotel_checkout_date,
        'transport_return_date', p_transport_return_date,
        'transport_return_time', p_transport_return_time,
        'pickup_location', p_pickup_location,
        'dropoff_location', p_dropoff_location
    );

    UPDATE public.order_items SET
        scheduled_date = p_scheduled_date,
        scheduled_time = p_scheduled_time,
        hotel_checkout_date = p_hotel_checkout_date,
        transport_return_date = p_transport_return_date,
        transport_return_time = p_transport_return_time,
        pickup_location = p_pickup_location,
        dropoff_location = p_dropoff_location,
        updated_at = now()
    WHERE id = p_order_item_id;

    INSERT INTO public.order_item_schedule_edits (
        order_item_id, order_id, edited_by, before_values, after_values
    ) VALUES (
        p_order_item_id, v_row.order_id, p_admin_id, v_before, v_after
    );

    RETURN jsonb_build_object(
        'order_item_id', p_order_item_id,
        'before', v_before,
        'after', v_after
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_order_item_schedule(
    UUID, UUID, DATE, TIME, DATE, DATE, TIME, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_order_item_schedule(
    UUID, UUID, DATE, TIME, DATE, DATE, TIME, TEXT, TEXT
) TO service_role;
