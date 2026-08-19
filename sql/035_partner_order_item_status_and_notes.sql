-- ============================================================
-- 035_partner_order_item_status_and_notes.sql
--
-- Backs two routes that already exist in the app but have nothing to
-- call yet: app/api/partner/order-items/[id]/status/route.ts and
-- .../notes/route.ts. Both call RPCs (partner_update_order_item_status,
-- partner_update_order_item_notes) that this migration is the first
-- to actually create — their code comments say "migration 034" but
-- 034_find_or_create_customer.sql is unrelated (find_or_create_customer
-- for app/api/orders/route.ts). Until this runs, both routes 500 with
-- "function does not exist".
--
-- 1. order_items.partner_notes — per-item notes a partner can edit.
--    Deliberately NOT orders.notes: an order can carry items from more
--    than one partner, so a shared order-level notes field isn't safe
--    for a single partner to write to (see lib/partner/orders.ts —
--    getPartnerOrderById already filters items down to the calling
--    partner's own for the same reason).
--
-- 2. partner_update_order_item_status / partner_update_order_item_notes
--    — SECURITY DEFINER, ownership re-checked inside the function
--    (order_items.partner_id = p_partner_id) as defense-in-depth on
--    top of the route's own session + hasPermission('manage_bookings')
--    check. Raises 'order_item_not_found' / 'not_owner' verbatim —
--    both routes match on those exact strings to return 404 without
--    revealing which case it was.
--
-- Status validity is enforced twice: the route's own ALLOWED_STATUSES
-- allowlist, and the table's existing chk_item_status CHECK constraint
-- (migration 008) — an invalid value fails the UPDATE with a check-
-- constraint violation, so the function doesn't re-validate it.
--
-- Same lockdown pattern as every RPC since migration 027: REVOKE from
-- PUBLIC *and* anon/authenticated explicitly, then GRANT to
-- service_role only — these are only ever called from the two route
-- handlers above via the service-role client.
--
-- Safe to re-run (CREATE OR REPLACE FUNCTION, ADD COLUMN IF NOT
-- EXISTS, idempotent grants).
-- ============================================================

ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS partner_notes TEXT;

-- ------------------------------------------------------------
-- DROP first: a prior run (or a leftover partial migration) may have
-- created this function with a different return type — Postgres
-- won't let CREATE OR REPLACE change a function's return type in
-- place (error 42P13), only its body. Safe to re-run: DROP ... IF
-- EXISTS is a no-op when there's nothing to drop.
DROP FUNCTION IF EXISTS public.partner_update_order_item_status(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.partner_update_order_item_status(
    p_order_item_id UUID,
    p_partner_id UUID,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row RECORD;
BEGIN
    SELECT * INTO v_row FROM public.order_items WHERE id = p_order_item_id;
    IF v_row IS NULL THEN
        RAISE EXCEPTION 'order_item_not_found';
    END IF;
    IF v_row.partner_id IS DISTINCT FROM p_partner_id THEN
        RAISE EXCEPTION 'not_owner';
    END IF;

    UPDATE public.order_items
    SET status = p_new_status,
        updated_at = now()
    WHERE id = p_order_item_id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'status', v_row.status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.partner_update_order_item_status(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_update_order_item_status(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.partner_update_order_item_status(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.partner_update_order_item_status(UUID, UUID, TEXT) TO service_role;

-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.partner_update_order_item_notes(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.partner_update_order_item_notes(
    p_order_item_id UUID,
    p_partner_id UUID,
    p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row RECORD;
BEGIN
    SELECT * INTO v_row FROM public.order_items WHERE id = p_order_item_id;
    IF v_row IS NULL THEN
        RAISE EXCEPTION 'order_item_not_found';
    END IF;
    IF v_row.partner_id IS DISTINCT FROM p_partner_id THEN
        RAISE EXCEPTION 'not_owner';
    END IF;

    UPDATE public.order_items
    SET partner_notes = p_notes,
        updated_at = now()
    WHERE id = p_order_item_id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'partner_notes', v_row.partner_notes
    );
END;
$$;

REVOKE ALL ON FUNCTION public.partner_update_order_item_notes(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_update_order_item_notes(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.partner_update_order_item_notes(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.partner_update_order_item_notes(UUID, UUID, TEXT) TO service_role;
