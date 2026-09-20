-- ============================================================
-- 101_partner_commercial_terms_history.sql
--
-- CONTEXT — what this closes and why:
--
-- 098 created partner_commercial_terms with `partner_id UUID NOT NULL
-- UNIQUE`, i.e. exactly one rate row per partner, ever. That makes two
-- things impossible that the business now needs:
--   1. Rate history — audit rounds flagged that changing a partner's
--      rate today silently loses what the rate used to be.
--   2. A commission that was ALREADY charged staying charged at the
--      rate that was in effect when it was charged, even after the
--      partner's rate changes later (financial-integrity requirement
--      — see 102, which will start snapshotting commission_rate on
--      order_items and needs an "active rate as of a point in time"
--      concept to snapshot FROM).
--
-- This migration turns partner_commercial_terms from a 1-row-per-
-- partner settings table into a period table: many rows per partner,
-- each with a non-overlapping [effective_from, effective_until) window.
-- Exactly one row per partner may have effective_until IS NULL (the
-- currently active rate) at any moment — enforced by the exclusion
-- constraint below, not just convention.
--
-- Not touched here: the 12.00 COALESCE fallback in
-- calculate_order_item_commission() for partners with zero terms rows
-- at all. That's a separate, deliberate decision (turn "no active
-- term" into a hard block instead of a silent default) tracked as its
-- own follow-up migration once the order_items snapshot work lands —
-- bundling it into this migration would couple an unrelated behavior
-- change to a schema change, making this harder to review and revert
-- independently. This migration DOES fix the trigger's lookup query
-- (below) because that part is mechanically required by the schema
-- change itself: once a partner can have multiple terms rows, "SELECT
-- ... WHERE partner_id = x" without a time filter returns an
-- arbitrary row, which is a correctness bug this migration would
-- otherwise introduce, not preserve.
--
-- Idempotent — safe to re-run, same convention as the rest of /sql.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Drop the constraint that makes history impossible
-- ------------------------------------------------------------
ALTER TABLE public.partner_commercial_terms
    DROP CONSTRAINT IF EXISTS partner_commercial_terms_partner_id_key;

-- ------------------------------------------------------------
-- 2. Add period + provenance columns
-- ------------------------------------------------------------
ALTER TABLE public.partner_commercial_terms
    ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS effective_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS mou_reference TEXT;

COMMENT ON COLUMN public.partner_commercial_terms.effective_from IS
    'Start of this rate''s validity window (inclusive). NOT NULL after backfill below.';
COMMENT ON COLUMN public.partner_commercial_terms.effective_until IS
    'End of this rate''s validity window (exclusive). NULL = currently active — exactly one such row per partner_id, enforced by the exclusion constraint below.';
COMMENT ON COLUMN public.partner_commercial_terms.mou_reference IS
    'MOU/agreement document number this rate is drawn from. Separate from `notes` (free text) so it can be searched/displayed as its own field.';

-- Backfill: every row that predates this migration (098's original
-- 1-row-per-partner rows) becomes that partner's currently-active
-- period, starting when the row was created.
UPDATE public.partner_commercial_terms
SET effective_from = created_at
WHERE effective_from IS NULL;

ALTER TABLE public.partner_commercial_terms
    ALTER COLUMN effective_from SET NOT NULL,
    ALTER COLUMN effective_from SET DEFAULT now();

-- ------------------------------------------------------------
-- 3. Enforce "no two periods for the same partner overlap in time",
--    including the open-ended (effective_until IS NULL) case, at the
--    database level — not just in application code. Requires
--    btree_gist for the UUID equality term inside an EXCLUDE USING gist.
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.partner_commercial_terms
    DROP CONSTRAINT IF EXISTS partner_commercial_terms_no_overlap;

ALTER TABLE public.partner_commercial_terms
    ADD CONSTRAINT partner_commercial_terms_no_overlap
    EXCLUDE USING gist (
        partner_id WITH =,
        tstzrange(effective_from, effective_until, '[)') WITH &&
    );

CREATE INDEX IF NOT EXISTS idx_partner_commercial_terms_partner_active
    ON public.partner_commercial_terms (partner_id, effective_from DESC);

-- ------------------------------------------------------------
-- 4. Fix the commission trigger's lookup to pick the row whose
--    window contains "now" (the currently-active rate), instead of
--    an arbitrary row for the partner. Fallback to 12.00 when a
--    partner has no active term at all is UNCHANGED here — see the
--    header note above for why that's deliberately out of scope for
--    this migration.
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
  WHERE partner_id = NEW.partner_id
    AND effective_from <= now()
    AND (effective_until IS NULL OR effective_until > now())
  ORDER BY effective_from DESC
  LIMIT 1;

  NEW.commission_amount := ROUND(COALESCE(NEW.price, 0) * COALESCE(v_rate, 12.00) / 100, 2);

  RETURN NEW;
END;
$$;

-- Trigger binding is unchanged (still BEFORE INSERT OR UPDATE OF
-- price, partner_id) — only the function body above changed, so no
-- DROP/CREATE TRIGGER needed here.

-- ------------------------------------------------------------
-- 5. Atomic "start a new rate period" function. The admin route does
--    this as close-current-row + insert-new-row; those must not be
--    two separate REST round-trips against a financial table (a crash
--    or timeout between them leaves the partner with NO active row,
--    which silently falls back to the 12.00 MOU default for any
--    order created in the gap — the exact "hidden fallback" failure
--    mode 098's design decision 3 already accepted once and that this
--    migration is not the place to reintroduce). FOR UPDATE locks the
--    current-open row for the duration of the transaction so two
--    concurrent rate changes for the same partner can't both read
--    "no current row" and insert two open rows (which the exclusion
--    constraint would catch anyway, but this fails with a clear
--    application-level error instead of a raw constraint-violation
--    message reaching the admin).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_partner_commercial_term_period(
    p_partner_id UUID,
    p_commercial_fee_rate NUMERIC,
    p_effective_from TIMESTAMPTZ,
    p_pilot_started_at DATE,
    p_pilot_ends_at DATE,
    p_notes TEXT,
    p_mou_reference TEXT,
    p_created_by UUID
)
RETURNS public.partner_commercial_terms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_open public.partner_commercial_terms;
  v_new_row public.partner_commercial_terms;
BEGIN
  SELECT * INTO v_current_open
  FROM public.partner_commercial_terms
  WHERE partner_id = p_partner_id AND effective_until IS NULL
  FOR UPDATE;

  IF FOUND AND v_current_open.effective_from >= p_effective_from THEN
    RAISE EXCEPTION 'effective_from_before_current_period'
      USING DETAIL = 'New period must start strictly after the current period''s effective_from';
  END IF;

  IF FOUND THEN
    UPDATE public.partner_commercial_terms
    SET effective_until = p_effective_from
    WHERE id = v_current_open.id;
  END IF;

  INSERT INTO public.partner_commercial_terms (
      partner_id, commercial_fee_rate, effective_from, effective_until,
      pilot_started_at, pilot_ends_at, notes, mou_reference, created_by
  ) VALUES (
      p_partner_id, p_commercial_fee_rate, p_effective_from, NULL,
      p_pilot_started_at, p_pilot_ends_at, p_notes, p_mou_reference, p_created_by
  )
  RETURNING * INTO v_new_row;

  RETURN v_new_row;
END;
$$;

-- SECURITY DEFINER + no PUBLIC/anon/authenticated grant, same
-- reasoning as every other write path on this table (098's header):
-- only the admin route, using the service-role client, calls this.
REVOKE ALL ON FUNCTION public.start_partner_commercial_term_period FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_partner_commercial_term_period TO service_role;

COMMIT;

-- ------------------------------------------------------------
-- Sanity checks after applying:
-- ------------------------------------------------------------
-- 1. Every partner with any terms row has exactly one currently-open row:
--   SELECT partner_id, count(*) FROM public.partner_commercial_terms
--   WHERE effective_until IS NULL GROUP BY partner_id HAVING count(*) > 1;
--   -- expect 0 rows
--
-- 2. The overlap constraint actually rejects overlapping periods:
--   -- (run inside a transaction you roll back)
--   INSERT INTO public.partner_commercial_terms
--     (partner_id, commercial_fee_rate, effective_from, effective_until)
--   SELECT partner_id, commercial_fee_rate, effective_from, effective_until
--   FROM public.partner_commercial_terms LIMIT 1;
--   -- expect: ERROR: conflicting key value violates exclusion constraint
--   -- "partner_commercial_terms_no_overlap"
--
-- 3. commission_amount still computes for existing partners:
--   SELECT id, partner_id, price, commission_amount
--   FROM public.order_items WHERE partner_id IS NOT NULL LIMIT 5;
-- ============================================================
