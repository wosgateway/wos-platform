-- ============================================================
-- 098_wos_mou_commercial_fee_engine.sql
--
-- CONTEXT — what this closes and why it's shaped this way:
--
-- The WOS Founding Partner MOU (ข้อ 3, Commercial Terms) commits WOS
-- to a per-partner commission rate (default 12%) charged on realized
-- service value. Confirmed against the live schema (see 010's audit
-- comment) that no table anywhere stores a fee rate — `partners`,
-- `order_items`, and `settlements` all reference each other via
-- `partner_id` (post-010 rename) but none of them carry a rate.
-- `settlements.platform_fee` is filled in by hand today.
--
-- DESIGN DECISION 1 — new table, not a column on `partners`:
--   `partners` has `FOR SELECT USING (true)` and a second
--   `USING (status = 'active')` policy (both from 006) — i.e. its
--   full row, every column, is world-readable via the anon
--   PostgREST API today (RLS is row-level, not column-level; nothing
--   in this schema does column filtering). Putting
--   `commercial_fee_rate` directly on `partners` would broadcast
--   every partner's negotiated commission to any anonymous visitor
--   hitting /rest/v1/partners. MOU ข้อ 7 explicitly requires this
--   stay confidential. So the rate lives in a new table with its own
--   RLS instead of riding on a table that's public-read by design.
--
-- DESIGN DECISION 2 — trigger, not a GENERATED column:
--   order_items.commission_amount needs partners/partner_commercial_
--   terms.commercial_fee_rate, a cross-table lookup. Postgres
--   GENERATED ALWAYS AS does not allow subqueries, so this has to be
--   a BEFORE INSERT/UPDATE trigger — same shape as
--   sync_trip_event_partner() in 076, reused here rather than
--   inventing a new pattern.
--
-- DESIGN DECISION 3 — fallback rate, not a hard failure:
--   The 12 live `partners` rows predate this migration and won't
--   have a partner_commercial_terms row until backfilled (done below,
--   step 4). The trigger COALESCEs to 12.00 so an order_item insert
--   never fails for a partner whose terms row is somehow missing —
--   fails soft to the MOU default rather than blocking a booking.
--
-- SCOPE NOTE: this migration adds the rate + per-line commission
-- calculation only. Rolling order_items.commission_amount up into
-- settlements.platform_fee at settlement-generation time is
-- application-layer work (wherever settlements rows currently get
-- created) — not touched here since that code wasn't in scope of
-- this review.
--
-- Idempotent — safe to re-run, same convention as the rest of /sql.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. partner_commercial_terms — confidential, 1:1 with partners
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_commercial_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL UNIQUE REFERENCES public.partners(id) ON DELETE CASCADE,

    commercial_fee_rate NUMERIC(5,2) NOT NULL DEFAULT 12.00,  -- MOU ข้อ 3 default

    -- MOU ข้อ 5: pilot partners get setup/monthly fees waived for a
    -- fixed window. Tracked here (not on `partners`) for the same
    -- confidentiality reason as the fee rate.
    pilot_started_at DATE,
    pilot_ends_at DATE,

    notes TEXT,  -- free text: MOU reference no., special package terms, etc.

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_commercial_fee_rate_range
        CHECK (commercial_fee_rate >= 0 AND commercial_fee_rate <= 100),
    CONSTRAINT chk_pilot_window
        CHECK (pilot_ends_at IS NULL OR pilot_started_at IS NULL OR pilot_ends_at >= pilot_started_at)
);

CREATE INDEX IF NOT EXISTS idx_partner_commercial_terms_partner_id
    ON public.partner_commercial_terms(partner_id);

DROP TRIGGER IF EXISTS set_updated_at_partner_commercial_terms ON public.partner_commercial_terms;
CREATE TRIGGER set_updated_at_partner_commercial_terms
    BEFORE UPDATE ON public.partner_commercial_terms
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.partner_commercial_terms ENABLE ROW LEVEL SECURITY;

-- No anon policy at all — default deny. A partner may see their OWN
-- rate (MOU transparency toward the signing partner, still private
-- from everyone else); writes are service-role only (admin app),
-- matching how settlements/order_items writes are already handled.
DROP POLICY IF EXISTS "Partners can view their own commercial terms" ON public.partner_commercial_terms;
CREATE POLICY "Partners can view their own commercial terms" ON public.partner_commercial_terms
    FOR SELECT TO authenticated
    USING (partner_id = public.current_user_partner_id());

-- ------------------------------------------------------------
-- 2. order_items — add the computed commission column
-- ------------------------------------------------------------
ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.order_items.commission_amount IS
    'Computed by calculate_order_item_commission() trigger from partner_commercial_terms.commercial_fee_rate (falls back to 12.00 MOU default). Not directly writable.';

-- ------------------------------------------------------------
-- 3. Trigger — recompute commission whenever price or partner_id
--    changes. Same pattern as sync_trip_event_partner() (076).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_order_item_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate NUMERIC(5,2);
BEGIN
  SELECT commercial_fee_rate INTO v_rate
  FROM public.partner_commercial_terms
  WHERE partner_id = NEW.partner_id;

  NEW.commission_amount := ROUND(COALESCE(NEW.price, 0) * COALESCE(v_rate, 12.00) / 100, 2);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_calculate_commission ON public.order_items;
CREATE TRIGGER order_items_calculate_commission
    BEFORE INSERT OR UPDATE OF price, partner_id ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.calculate_order_item_commission();

-- ------------------------------------------------------------
-- 4. Backfill — give all 12 live partners an explicit terms row at
--    the MOU default (12%) instead of relying on the trigger's
--    fallback forever. Admin can adjust individual rates after.
-- ------------------------------------------------------------
INSERT INTO public.partner_commercial_terms (partner_id, commercial_fee_rate)
SELECT id, 12.00 FROM public.partners
ON CONFLICT (partner_id) DO NOTHING;

-- Recompute commission_amount for any order_items that existed
-- before this migration (trigger only fires on future INSERT/UPDATE).
-- `SET price = price` is a genuine UPDATE OF price as far as Postgres
-- is concerned — column-specific triggers fire off the SET list, not
-- off whether the value actually changed (same fact 076's header
-- comment relies on for trip_events_sync_partner) — so this reliably
-- re-fires calculate_order_item_commission() for every existing row.
UPDATE public.order_items
SET price = price
WHERE partner_id IS NOT NULL;

COMMIT;

-- ------------------------------------------------------------
-- Sanity checks after applying (expect: 12 rows, all order_items
-- with a partner_id have a non-null commission_amount)
-- ------------------------------------------------------------
-- SELECT count(*) FROM public.partner_commercial_terms;
-- SELECT id, partner_id, price, commission_amount FROM public.order_items WHERE partner_id IS NOT NULL;
