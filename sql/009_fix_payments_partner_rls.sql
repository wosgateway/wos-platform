-- ============================================================
-- MIGRATION 009: Fix payments RLS €” order-level payments were
-- invisible to partners
--
-- Bug: the SELECT policy added in migration 008
-- ("Partners can view payments for their order items") only
-- matched `order_item_id IN (...)`. Since `payments.order_item_id`
-- is nullable €” NULL meaning "this payment applies to the whole
-- order, not one item" per the migration 008 design €” any
-- order-level payment had `NULL IN (...)`, which is never true in
-- SQL. Partners could never see order-level payments in their own
-- dashboard, even for orders that included their own org's items.
--
-- Fix: split into two branches €”
--   1. item-level payments (order_item_id IS NOT NULL): still
--      scoped strictly to the partner's own order_items, same
--      isolation as before (partner A still can't see a payment
--      tied specifically to partner B's item in a shared order).
--   2. order-level payments (order_item_id IS NULL): visible to
--      any partner that has at least one order_item in that order,
--      since a lump-sum payment against the whole order affects
--      every partner's balance in it, not just one.
-- ============================================================

DROP POLICY IF EXISTS "Partners can view payments for their order items" ON public.payments;

CREATE POLICY "Partners can view payments for their order items" ON public.payments
    FOR SELECT USING (
        (
            order_item_id IS NOT NULL
            AND order_item_id IN (
                SELECT id FROM public.order_items
                WHERE organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
            )
        )
        OR
        (
            order_item_id IS NULL
            AND order_id IN (
                SELECT order_id FROM public.order_items
                WHERE organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
            )
        )
    );
