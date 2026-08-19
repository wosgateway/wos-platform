-- ============================================================
-- MIGRATION 013: add the booking-detail columns BookingForm.tsx
-- needs, and support "let the team decide" hotel/transport items
-- where no specific package is chosen yet at booking time.
--
-- Context: connecting BookingForm.tsx to create_order_with_items()
-- (migration 012) surfaced 5 pieces of data the current order_items/
-- orders schema has nowhere to put:
--   1. hotel checkout date (only checkin fits in scheduled_date)
--   2. transport_mode (one_way / round_trip / daily)
--   3. transport return date/time (round_trip only)
--   4. attachment_url (id doc / referral letter upload)
--   5. "let team decide" hotel/transport €” customer can leave the
--      partner unpicked; no real package_id exists yet to resolve
--      price/partner from, so package_id/partner_id/price/
--      deposit_required must become nullable, with a flag marking
--      the row as awaiting manual assignment.
-- ============================================================

-- ------------------------------------------------------------
-- 1. orders: single attachment per order (id doc / referral letter)
-- ------------------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS attachment_url TEXT;

-- ------------------------------------------------------------
-- 2. order_items: new booking-detail columns
-- ------------------------------------------------------------
ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS hotel_checkout_date DATE,
    ADD COLUMN IF NOT EXISTS transport_mode TEXT,
    ADD COLUMN IF NOT EXISTS transport_return_date DATE,
    ADD COLUMN IF NOT EXISTS transport_return_time TIME,
    ADD COLUMN IF NOT EXISTS needs_assignment BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_transport_mode_check;
ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_transport_mode_check
    CHECK (transport_mode IS NULL OR transport_mode IN ('one_way', 'round_trip', 'daily'));

-- ------------------------------------------------------------
-- 3. order_items: allow "let team decide" rows €” no package/partner/
--    price known yet, filled in manually by an admin later.
--    Safe to run even with existing rows: existing rows already
--    have all of these populated, so DROP NOT NULL is a no-op for
--    them.
-- ------------------------------------------------------------
ALTER TABLE public.order_items ALTER COLUMN package_id DROP NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN partner_id DROP NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN price DROP NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN deposit_required DROP NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN deposit_rule_id DROP NOT NULL;

-- A row is either fully resolved (package_id set, needs_assignment
-- false) or a placeholder awaiting assignment (package_id null,
-- needs_assignment true) €” never a silent in-between state.
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_assignment_consistency_check;
ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_assignment_consistency_check
    CHECK (
        (needs_assignment = false AND package_id IS NOT NULL AND partner_id IS NOT NULL)
        OR
        (needs_assignment = true AND package_id IS NULL AND partner_id IS NULL)
    );

-- ------------------------------------------------------------
-- NOTE: order total triggers (wherever total_amount /
-- total_deposit_required get summed on `orders`) must use SUM(),
-- which already skips NULLs €” a needs_assignment row with price
-- NULL simply contributes 0 to the running total until an admin
-- fills it in. No trigger changes required *if* that's how the
-- existing trigger is written; worth a quick check if totals look
-- off after this migration.
-- ------------------------------------------------------------
