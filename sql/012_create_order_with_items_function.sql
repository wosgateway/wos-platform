-- ============================================================
-- MIGRATION 012: create_order_with_items() €” atomic order creation
-- for the customer-facing booking API route.
--
-- Supersedes the earlier draft of this function (which trusted
-- client-supplied organization_id/service_type/price directly).
-- After confirming the real schema against live Supabase data:
--   - packages.partner_id -> partners(id) is the real identity
--     chain (see migration 010) €” NOT organizations.
--   - packages has no service_type column. The only service
--     classification that exists is partners.category
--     ('Hospital'|'Clinic'|'Dental'|'Wellness'|'Spa'|'Hotel'|
--     'Transport'), which this function maps to the service_type
--     enum order_items/deposit_rules actually use
--     ('clinic'|'hotel'|'transport'|'wellness'|'insurance').
--   - packages.original_price/special_price are the only real
--     prices. The client now sends package_id + quantity (nights
--     for hotel, days for transport, 1 otherwise) €” never a price
--     or a service_type €” so a tampered request can't submit an
--     arbitrary price or claim a cheaper category's deposit rate.
--
-- Still SECURITY DEFINER, still service_role-only (no customer auth
-- yet €” see migration 008 note), still atomic (order + every
-- order_item succeed or fail together).
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_order_with_items(
    p_patient_id UUID,   -- references public.customers.id (see migration 011)
    p_items JSONB,        -- [{ "package_id", "quantity"?, "scheduled_date"?, "scheduled_time"? }, ...]
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id UUID;
    v_order_number TEXT;
    v_item JSONB;
    v_pkg RECORD;
    v_partner RECORD;
    v_rule RECORD;
    v_service_type TEXT;
    v_quantity NUMERIC;
    v_unit_price NUMERIC(12,2);
    v_price NUMERIC(12,2);
    v_deposit NUMERIC(12,2);
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'order must have at least one item';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_patient_id) THEN
        RAISE EXCEPTION 'unknown patient_id %', p_patient_id;
    END IF;

    INSERT INTO public.orders (patient_id, status, notes)
    VALUES (p_patient_id, 'draft', p_notes)
    RETURNING id, order_number INTO v_order_id, v_order_number;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        IF NOT (v_item ? 'package_id') THEN
            RAISE EXCEPTION 'each item requires package_id';
        END IF;

        -- Only real, published packages can be booked €” matches the
        -- same status filter the public catalog (data.ts) already
        -- uses so a draft/rejected/archived package can't be booked
        -- via a direct API call even if its id leaks somehow.
        SELECT * INTO v_pkg FROM public.packages
        WHERE id = (v_item->>'package_id')::UUID AND status = 'published';

        IF v_pkg IS NULL THEN
            RAISE EXCEPTION 'unknown or unpublished package_id %', v_item->>'package_id';
        END IF;

        SELECT * INTO v_partner FROM public.partners WHERE id = v_pkg.partner_id;
        IF v_partner IS NULL THEN
            RAISE EXCEPTION 'package % has no valid partner', v_pkg.id;
        END IF;

        -- Map the real partners.category enum onto the service_type
        -- enum order_items/deposit_rules use. Adjust this mapping if
        -- the business logic differs (e.g. Dental deserving its own
        -- deposit rule tier instead of folding into 'clinic').
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

        IF v_service_type IS NULL THEN
            RAISE EXCEPTION 'partner category % has no service_type mapping', v_partner.category;
        END IF;

        v_quantity := COALESCE((v_item->>'quantity')::NUMERIC, 1);
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'quantity must be positive for package %', v_pkg.id;
        END IF;

        v_unit_price := COALESCE(v_pkg.special_price, v_pkg.original_price);
        v_price := ROUND(v_unit_price * v_quantity, 2);

        -- Resolve deposit rule: exact (service_type, partner) match
        -- wins over the global default (partner_id IS NULL); priority
        -- breaks ties within the same specificity level.
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

        INSERT INTO public.order_items (
            order_id, partner_id, package_id, service_type,
            price, deposit_required, scheduled_date, scheduled_time,
            deposit_rule_id
        ) VALUES (
            v_order_id,
            v_partner.id,
            v_pkg.id,
            v_service_type,
            v_price,
            v_deposit,
            NULLIF(v_item->>'scheduled_date', '')::DATE,
            NULLIF(v_item->>'scheduled_time', '')::TIME,
            v_rule.id
        );
    END LOOP;

    UPDATE public.orders SET status = 'pending_deposit' WHERE id = v_order_id;

    RETURN jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number);
END;
$$;

-- SECURITY DEFINER functions are PUBLIC-executable by default in
-- Postgres €” explicitly lock this down to service_role only.
REVOKE ALL ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(UUID, JSONB, TEXT) TO service_role;
