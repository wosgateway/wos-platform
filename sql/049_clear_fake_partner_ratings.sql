-- ============================================================
-- 049_clear_fake_partner_ratings.sql
-- Purpose: `reviews` table has 0 records, so every value currently
-- sitting in partners.rating / partners.review_count is fake /
-- hand-entered data, not derived from real reviews. Clear it so the
-- site stops showing fabricated ratings. Ratings should only be
-- repopulated once they are computed from real rows in `reviews`
-- (aggregate function / trigger), never entered manually again.
-- Safe to run anytime; idempotent.
-- ============================================================

-- 1) BASELINE — run first, keep the output for the record.
SELECT
  count(*)                      AS total_partners,
  count(rating)                 AS partners_with_rating,
  count(review_count)           AS partners_with_review_count
FROM public.partners;

-- 2) SANITY CHECK — confirm reviews is actually empty before clearing.
--    Expected: reviews_count = 0. If this is ever nonzero, STOP and
--    investigate before running the update below — it would mean
--    some ratings might be real.
SELECT count(*) AS reviews_count
FROM public.reviews;

-- 3) THE ACTUAL FIX — clear the fake values.
--    Wrapped in a transaction: if the post-check below doesn't show
--    all zeros, run ROLLBACK instead of COMMIT.
BEGIN;

UPDATE public.partners
SET rating = NULL,
    review_count = NULL;

-- 4) POST-CHECK — confirm the clear worked.
--    Expected: rating_remaining = 0, review_count_remaining = 0.
--    If not zero: ROLLBACK; and investigate before retrying.
SELECT
  count(*) FILTER (WHERE rating IS NOT NULL)       AS rating_remaining,
  count(*) FILTER (WHERE review_count IS NOT NULL) AS review_count_remaining
FROM public.partners;

COMMIT;

