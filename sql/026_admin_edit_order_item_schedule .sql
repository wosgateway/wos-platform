-- ============================================================
-- MIGRATION 026: admin_update_order_item_schedule() — lets an
-- admin correct the transport pickup/return date-time and hotel
-- check-in/checkout date-time (plus pickup/dropoff location text
-- from migration 024) on an order_items row AFTER partner
-- confirmation but BEFORE the quotation is printed/sent.
--
-- Why: the customer enters a *requested* date/time at booking time
-- (create_order_with_items(), migration 014/025), but the real
-- partner (hotel/transport) may only be able to confirm a different
-- slot. Without this, fixing that requires cancelling and recreating
-- the whole order, which disturbs payment_access_token / deposit
-- state already attached to it (migration 021/022).
--
-- Scope: hotel/transport order_items only (service_type IN
-- ('hotel','transport')) — same scope restriction as the
-- reassignment RPCs (016/017/018). Editable columns:
--   scheduled_date, scheduled_time            (pickup / check-in)
--   hotel_checkout_date
--   transport_return_date, transport_return_time
--   pickup_location, dropoff_location          (migration 024)
--
-- This function always overwrites all 7 columns with the values
-- passed in — the admin edit form is expected to submit the full
-- current state (pre-filled), not a sparse patch. There is
-- therefore no NULL-means-"leave unchanged" ambiguity: NULL means
-- "clear this field", same as how the columns behave everywhere
-- else in the schema.
--
-- Guards (in order):
--   1. Row lock (FOR UPDATE) on both order_items and its parent
--      orders row — serializes concurrent edits the same way
--      022/018 do, instead of racing on a blind UPDATE.
--   2. service_type must be 'hotel' or 'transport'.
--   3. order_items.status must NOT be 'cancelled' or 'refunded'.
--      NOTE: as of this migration, nothing in the reviewed codebase
--      (migrations 008-025, admin API routes reviewed so far) is
--      seen writing to order_items.status — it may be dead, or set
--      by code not yet reviewed (e.g. partner portal). This check
--      is included defensively per product decision; it is cheap
--      and correct either way (a cancelled/refunded item should
--      never have its schedule "corrected").
--   4. orders.status must be 'draft', 'pending_deposit', or
--      'deposit_paid' — the exact same boundary migration 018 uses
--      for hotel/transport reassignment ("locked once confirmed").
--      Once staff mark the order 'confirmed' (or checked_in /
--      completed / cancelled / refunded), the schedule is locked;
--      any further change must go through a different, more
--      deliberate path (not created here).
--
-- Audit trail: every successful edit writes one row to the new
-- order_item_schedule_edits table capturing who, when, and the full
-- before/after column values as jsonb — so a customer dispute
-- ("I never asked to change the time") can be checked against a
-- record of which admin changed what and when.
--
-- Safe to re-run (CREATE OR REPLACE / CREATE TABLE IF NOT EXISTS).
-- ============================================================

-- ------------------------------------------------------------
-- Audit trail table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_item_schedule_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id UUID NOT NULL REFERENCES public.order_items(id),
    order_id UUID NOT NULL REFERENCES public.orders(id),
    edited_by UUID NOT NULL,
    edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    before_values JSONB NOT NULL,
    after_values JSONB NOT NULL
);

COMMENT ON TABLE public.order_item_schedule_edits IS
  'Audit log for admin_update_order_item_schedule() (migration 026). One row per successful edit call, full before/after snapshot of the 7 editable columns, so a customer schedule dispute can be checked against who changed what and when.';

CREATE INDEX IF NOT EXISTS idx_order_item_schedule_edits_order_item_id
  ON public.order_item_schedule_edits (order_item_id);

CREATE INDEX IF NOT EXISTS idx_order_item_schedule_edits_order_id
  ON public.order_item_schedule_edits (order_id);

-- RLS is enabled with NO policies — same convention noted in
-- BookingsManager.tsx's header comment for customers/order_items
-- ("no admin-readable RLS policy"). This means anon/authenticated
-- roles (i.e. anything reachable from the browser Supabase client)
-- get a hard deny on every row; the only way in is the service-role
-- client used by the admin API route, which bypasses RLS entirely.
-- Audit rows exist specifically to survive a dispute, so they should
-- be even less exposed to the browser than order_items itself — no
-- policy is ever added here, not even a read-only one for admins.
ALTER TABLE public.order_item_schedule_edits ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- admin_update_order_item_schedule()
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
    -- Lock the order_items row first so a concurrent edit (or a
    -- concurrent reassignment via admin_assign_order_item) on the
    -- same row serializes behind this transaction instead of
    -- racing.
    SELECT * INTO v_row FROM public.order_items WHERE id = p_order_item_id FOR UPDATE;
    IF v_row IS NULL THEN
        RAISE EXCEPTION 'order_item % not found', p_order_item_id;
    END IF;

    IF v_row.service_type NOT IN ('hotel', 'transport') THEN
        RAISE EXCEPTION
            'schedule editing via this path is only supported for hotel/transport items (got service_type=%)',
            v_row.service_type;
    END IF;

    -- Defensive: order_items.status has its own lifecycle
    -- (chk_item_status: pending/confirmed/checked_in/completed/
    -- cancelled/refunded) separate from orders.status. Nothing
    -- reviewed so far writes to it, but a cancelled/refunded item
    -- must never have its schedule "corrected" regardless of where
    -- that status came from.
    IF v_row.status IN ('cancelled', 'refunded') THEN
        RAISE EXCEPTION
            'cannot edit schedule for order_item %: item status is %',
            p_order_item_id, v_row.status;
    END IF;

    -- Lock the parent order row too (same reasoning as
    -- admin_verify_payment / partner_verify_payment, migration 022)
    -- and apply the exact same status boundary migration 018 uses
    -- for reassignment: locked once the order reaches 'confirmed'.
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

-- Same division of responsibility as admin_assign_order_item: the
-- admin session (and therefore p_admin_id) is verified in Next.js
-- via requireAdmin() *before* this is called; this function trusts
-- p_admin_id as given, same as every other admin_* RPC.
REVOKE ALL ON FUNCTION public.admin_update_order_item_schedule(
    UUID, UUID, DATE, TIME, DATE, DATE, TIME, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_order_item_schedule(
    UUID, UUID, DATE, TIME, DATE, DATE, TIME, TEXT, TEXT
) TO service_role;
