-- ============================================================
-- MIGRATION 015: fix — balance_remaining was missed in migration
-- 013's pass over nullable columns.
--
-- balance_remaining is derived from price (likely via a BEFORE
-- INSERT/UPDATE trigger computing price - deposit_paid). For a
-- needs_assignment row, price is NULL, so the derived value is also
-- NULL — but the column was still NOT NULL, so create_order_with_
-- items() failed with a 23502 violation on any "let team decide"
-- item (error confirmed against a live INSERT attempt, not
-- theoretical).
-- ============================================================

ALTER TABLE public.order_items ALTER COLUMN balance_remaining DROP NOT NULL;
