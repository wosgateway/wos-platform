-- ============================================================
-- 103_order_items_commission_rate_snapshot.sql
--
-- Phase 4 — Commission Rate Snapshot (wos_business_rules_lock.md
--   ข้อ 2: commission_base = partner_balance, ไม่ใช่ package_price)
--
-- Needs 102 (partner_balance) done first — it is. Two separate gaps
-- close here, both flagged but deliberately deferred by earlier
-- migrations:
--
-- GAP A — wrong commission base (098's original design):
--   calculate_order_item_commission() has computed commission_amount
--   as `price * rate` since 098 — i.e. WOS's cut was taken on the
--   FULL package price, including the portion (deposit_required /
--   wos_booking_fee) that isn't partner revenue at all. ข้อ 2 of the
--   business-rules lock is explicit that the commission base must be
--   partner_balance (price - deposit_required), not price. This was
--   left wrong in 098/101 on purpose — partner_balance didn't exist
--   as a real column until 102, so there was nothing correct to
--   multiply by yet. It exists now.
--
-- GAP B — rate not persisted per line (101's header, point 2):
--   101 made partner_commercial_terms a period table specifically so
--   a commission "stays charged at the rate that was in effect when
--   it was charged, even after the partner's rate changes later" —
--   but order_items never actually stored which rate produced its
--   commission_amount, only the resulting amount. Without the rate
--   itself on the row, that historical guarantee is unverifiable:
--   you can't tell, after a later rate change, whether a given
--   commission_amount used the old rate or the new one. This
--   migration adds order_items.commission_rate_snapshot to close
--   that — populated by the same trigger, same transaction, so it's
--   never possible for amount and snapshot to disagree.
--
-- WHY A TRIGGER COLUMN, NOT GENERATED:
--   Same reason as 098's design decision 2 — this needs a
--   cross-table lookup (partner_commercial_terms as of "now"), which
--   Postgres GENERATED ALWAYS AS cannot do (no subqueries). Unlike
--   partner_balance (102), which is a pure function of two columns
--   on the SAME row and could be GENERATED, commission_rate_snapshot
--   is a function of partner_commercial_terms at write time — a
--   snapshot by definition, not a formula Postgres can re-derive
--   later. That's also exactly why it must NOT be GENERATED: a
--   generated column would recompute against the CURRENT active rate
--   on every read/rewrite, silently defeating the whole point of
--   "stays charged at the rate in effect when it was charged."
--
-- TRIGGER COLUMN LIST — adding deposit_required:
--   The existing trigger (098, refined 101) only fires on
--   `INSERT OR UPDATE OF price, partner_id`. Now that the commission
--   base is partner_balance (= price - deposit_required),
--   deposit_required changing must also refire the calculation —
--   otherwise admin_assign_order_item() setting deposit_required
--   after price was already set (058/096) could leave a stale
--   commission_amount computed against the wrong base. Added below.
--
-- NULL HANDLING — unassigned ("let team decide") items:
--   partner_balance is NULL for these (102, by design — price and
--   deposit_required are both NULL until admin assignment). Rather
--   than silently defaulting the commission base to 0 (which is what
--   COALESCE(price, 0) did before this migration, and is misleading
--   for a line that has no commission yet, not a zero commission),
--   commission_amount and commission_rate_snapshot are both left
--   NULL when partner_balance can't be computed. This is a genuine
--   behavior change from 098/101 (which always wrote 0), scoped
--   deliberately to this migration since it only makes sense now
--   that "unassigned" has a real NULL signal to key off (partner_
--   balance) instead of having to infer it from price being 0.
--   commission_amount's NOT NULL constraint (098) is relaxed to
--   allow this — see step 1.
--
-- NOT TOUCHED, on purpose: settlements.platform_fee rollup (098's
-- original scope note — still application-layer work, still not
-- built, still out of scope here); partner_commercial_terms itself
-- (101 already gives correct point-in-time lookups, unchanged);
-- price/deposit_required/deposit_paid/balance_remaining/
-- partner_balance (102, all unmodified).
--
-- Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. order_items — add the snapshot column, relax commission_amount's
--    NOT NULL so both can be NULL together for unassigned items.
-- ------------------------------------------------------------
ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS commission_rate_snapshot NUMERIC(5,2);

ALTER TABLE public.order_items
    ALTER COLUMN commission_amount DROP NOT NULL,
    ALTER COLUMN commission_amount DROP DEFAULT;

COMMENT ON COLUMN public.order_items.commission_rate_snapshot IS
    'wos_business_rules_lock.md ข้อ 2 — the commercial_fee_rate read from partner_commercial_terms (or the 12.00 MOU fallback) at the moment calculate_order_item_commission() last ran for this row. Written by the trigger in the same transaction as commission_amount, so the two can never disagree. NULL when partner_balance is NULL (unassigned item — no rate has been applied to anything yet). This is what makes 101''s "stays charged at the rate in effect when charged" guarantee checkable after a partner''s rate later changes — do not backfill or edit this column by hand.';

COMMENT ON COLUMN public.order_items.commission_amount IS
    'Computed by calculate_order_item_commission() as partner_balance * commission_rate_snapshot / 100 (changed by migration 103 from price * rate — see that migration''s header, GAP A). NULL when partner_balance is NULL (unassigned item), not 0 — a genuine "no commission computed yet" rather than a zero commission. Not directly writable.';

-- ------------------------------------------------------------
-- 2. Trigger — recompute both columns off partner_balance, refire on
--    deposit_required too now that it feeds the commission base.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_order_item_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate NUMERIC(5,2);
  v_partner_balance NUMERIC(12,2);
BEGIN
  -- partner_balance is a GENERATED column on this same row, but
  -- GENERATED values aren't available yet inside a BEFORE trigger
  -- (Postgres computes them after BEFORE triggers run), so it's
  -- recomputed here from the same two source columns 102 uses.
  IF NEW.price IS NULL OR NEW.deposit_required IS NULL THEN
    v_partner_balance := NULL;
  ELSE
    v_partner_balance := NEW.price - NEW.deposit_required;
  END IF;

  IF v_partner_balance IS NULL THEN
    NEW.commission_rate_snapshot := NULL;
    NEW.commission_amount := NULL;
    RETURN NEW;
  END IF;

  SELECT commercial_fee_rate INTO v_rate
  FROM public.partner_commercial_terms
  WHERE partner_id = NEW.partner_id
    AND effective_from <= now()
    AND (effective_until IS NULL OR effective_until > now())
  ORDER BY effective_from DESC
  LIMIT 1;

  v_rate := COALESCE(v_rate, 12.00);

  NEW.commission_rate_snapshot := v_rate;
  NEW.commission_amount := ROUND(v_partner_balance * v_rate / 100, 2);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_calculate_commission ON public.order_items;
CREATE TRIGGER order_items_calculate_commission
    BEFORE INSERT OR UPDATE OF price, deposit_required, partner_id ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.calculate_order_item_commission();

COMMIT;

-- ============================================================
-- STOP — backfill is deliberately NOT part of the transaction above.
--
-- Reviewed after first draft: the backfill this migration originally
-- ran automatically (`UPDATE order_items SET price = price WHERE
-- partner_id IS NOT NULL`) refires the trigger for every existing
-- partner-assigned row against the CURRENTLY active rate — not
-- whatever rate was nominally in effect when the row was first
-- priced (098/101 never recorded that, so there is nothing to
-- recover). For a partner whose rate has since changed, that rewrites
-- a real, already-computed commission_amount to a different number.
-- If any of that data is tied to money that has actually moved
-- (settled, invoiced, paid out), this is a financial change, not a
-- schema change, and should not happen as a side effect of a DDL
-- migration nobody explicitly reviewed the output of first.
--
-- Schema + trigger above are safe to run right now regardless — they
-- only change behavior for FUTURE inserts/updates. Existing rows keep
-- their pre-103 commission_amount and get commission_rate_snapshot =
-- NULL until backfilled.
--
-- Before backfilling, run both of these and look at the results:
--
--   SELECT
--     COUNT(*) AS total_items,
--     COUNT(*) FILTER (WHERE partner_id IS NOT NULL) AS assigned_items,
--     COUNT(*) FILTER (WHERE commission_amount IS NOT NULL) AS commission_items,
--     COALESCE(SUM(commission_amount), 0) AS current_commission_total
--   FROM public.order_items;
--
--   SELECT
--     pct.commercial_fee_rate,
--     COUNT(oi.id) AS item_count,
--     COALESCE(SUM(oi.commission_amount), 0) AS commission_total
--   FROM public.order_items oi
--   LEFT JOIN public.partner_commercial_terms pct
--     ON pct.partner_id = oi.partner_id
--   WHERE oi.partner_id IS NOT NULL
--   GROUP BY pct.commercial_fee_rate
--   ORDER BY pct.commercial_fee_rate;
--
-- If commission_items is 0, or every row's rate group is exactly the
-- MOU default with no partner having changed rate since, there is
-- nothing to lose — run the backfill below as-is. If there's real
-- money already settled/paid out against the old (price-based)
-- commission_amount figures, reconcile those rows first (decide,
-- per partner, whether the old or new figure is the one of record)
-- before running this, or scope the WHERE clause below to exclude
-- whatever "already settled" means in this schema (e.g. exclude rows
-- linked to a paid settlement, once that link exists).
--
-- BEGIN;
-- UPDATE public.order_items
-- SET price = price
-- WHERE partner_id IS NOT NULL;
-- COMMIT;
--
-- Separately, note what neither this migration nor its backfill can
-- guarantee: commission_rate_snapshot is not immutable against FUTURE
-- edits either — the trigger refires (and overwrites the snapshot)
-- any time price, deposit_required, or partner_id is updated on a
-- row, including one that's already been settled. 103 only
-- guarantees "the snapshot reflects the rate at the last time the
-- trigger ran," not "this row can never be recalculated again."
-- Preventing edits to a settled/paid-out order_item needs a lock at
-- the application or settlement layer (e.g. a status check, or a
-- BEFORE trigger that rejects UPDATEs once a settlement references
-- the row) — that's a separate decision, not made here.
-- ============================================================

-- ------------------------------------------------------------
-- Sanity checks — split by whether the backfill above has been run.
-- ------------------------------------------------------------
-- Right after applying the transaction (schema + trigger only, no
-- backfill yet):
--
-- 1. commission_amount is always partner_balance * snapshot / 100
--    for any row that HAS a snapshot (rows the trigger has actually
--    touched — new/updated since this migration). Rows with NULL
--    commission_rate_snapshot are pre-existing and untouched on
--    purpose until backfilled; they're excluded here, not a failure:
--   SELECT id FROM public.order_items
--   WHERE partner_balance IS NOT NULL
--     AND commission_rate_snapshot IS NOT NULL
--     AND commission_amount IS DISTINCT FROM
--         ROUND(partner_balance * commission_rate_snapshot / 100, 2);
--   -- expect 0 rows
--
-- 2. Unassigned items have NULL for all three, not 0 (true
--    immediately, doesn't depend on backfill):
--   SELECT id, needs_assignment, partner_balance, commission_rate_snapshot, commission_amount
--   FROM public.order_items WHERE needs_assignment = true LIMIT 5;
--   -- expect partner_balance, commission_rate_snapshot, commission_amount all NULL
--
-- Only AFTER running the backfill step above:
--
-- 3. Every partner-assigned row has a non-NULL snapshot:
--   SELECT count(*) FROM public.order_items
--   WHERE partner_id IS NOT NULL AND partner_balance IS NOT NULL
--     AND commission_rate_snapshot IS NULL;
--   -- expect 0
-- ============================================================
