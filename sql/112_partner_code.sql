-- ============================================================
-- 112_partner_code.sql
--
-- CONTEXT — what this closes:
--
-- Partners have only ever been identified by `partners.id` (UUID).
-- That works for joins and for the app, and is unusable for every
-- human-facing artifact the business actually produces: settlement
-- statements, invoices, commission disputes, LINE/WhatsApp threads
-- with a clinic ("เคสของพันธมิตรรายไหน?"), and the MOU documents
-- themselves. A UUID cannot be read aloud, dictated over a phone
-- call, or typed without error.
--
-- This adds `partners.partner_code` — WOS-<CAT>-<NNNN>, e.g.
-- WOS-CLN-0007 — assigned automatically at INSERT and immutable
-- afterwards.
--
-- DESIGN DECISION 1 — one global sequence, not per-category counters:
--   Per-category counters would need either a counters table with
--   its own locking (a second concurrency problem to get wrong) or
--   a MAX(...)+1 read, which races. One `bigint` sequence is
--   race-free by construction. The tradeoff is that numbers are not
--   contiguous *within* a category (WOS-CLN-0004 may be followed by
--   WOS-CLN-0009) — accepted deliberately: the code's job is to be a
--   stable unique handle, not to count how many clinics we have.
--
-- DESIGN DECISION 2 — immutable once set:
--   Enforced by a trigger, not just convention. Once a code has been
--   printed on a settlement statement or an MOU, changing it in the
--   database means the paper record and the system disagree, with no
--   way to tell which one is wrong. The category prefix therefore
--   does NOT follow a later `partners.category` change either — see
--   the trigger's comment.
--
-- DESIGN DECISION 3 — not confidential, unlike partner_commercial_terms:
--   `partners` is world-readable by design (006: FOR SELECT USING
--   (true)), so anything added to this table is public. A partner
--   code is meant to be quoted in shared documents — that is fine
--   and intended here, and is exactly why the commission rate lives
--   in a separate table instead (098's design decision 1).
--
-- Idempotent — safe to re-run, same convention as the rest of /sql.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Sequence + code generator
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.partner_code_seq
    AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

REVOKE ALL ON SEQUENCE public.partner_code_seq FROM PUBLIC;
GRANT USAGE ON SEQUENCE public.partner_code_seq TO service_role;

-- Category -> 3-letter prefix. The CASE list matches the
-- partners_category_check CHECK constraint (006) exactly; an unknown
-- category falls back to 'GEN' rather than raising, so that adding a
-- new category in a future migration can never block partner
-- creation on this function being updated first.
CREATE OR REPLACE FUNCTION public.partner_code_prefix(p_category TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_category
    WHEN 'Hospital'  THEN 'HSP'
    WHEN 'Clinic'    THEN 'CLN'
    WHEN 'Dental'    THEN 'DNT'
    WHEN 'Wellness'  THEN 'WLN'
    WHEN 'Spa'       THEN 'SPA'
    WHEN 'Hotel'     THEN 'HTL'
    WHEN 'Transport' THEN 'TRP'
    ELSE 'GEN'
  END;
$$;

CREATE OR REPLACE FUNCTION public.generate_partner_code(p_category TEXT)
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'WOS-' || public.partner_code_prefix(p_category) || '-'
       || LPAD(nextval('public.partner_code_seq')::TEXT, 4, '0');
$$;

-- ------------------------------------------------------------
-- 2. Column + uniqueness
-- ------------------------------------------------------------
ALTER TABLE public.partners
    ADD COLUMN IF NOT EXISTS partner_code TEXT;

COMMENT ON COLUMN public.partners.partner_code IS
    'Human-quotable partner identifier, WOS-<CAT>-<NNNN>. Assigned automatically on INSERT by assign_partner_code(); immutable afterwards (enforced by trigger) because it appears on settlements/invoices/MOU documents. Public by design — this table is world-readable (006); confidential commercial data belongs in partner_commercial_terms instead.';

-- ------------------------------------------------------------
-- 3. Backfill existing rows, oldest first, so the numbering
--    reflects the order partners actually joined.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, category
    FROM public.partners
    WHERE partner_code IS NULL
    ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE public.partners
    SET partner_code = public.generate_partner_code(r.category)
    WHERE id = r.id;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_partner_code
    ON public.partners(partner_code);

ALTER TABLE public.partners
    ALTER COLUMN partner_code SET NOT NULL;

-- ------------------------------------------------------------
-- 4. Auto-assign on INSERT
--
-- Handles the provision route (/api/admin/partners/provision) and
-- the portal-access route without either of them having to know the
-- format — they insert a partner row as they always have, and get a
-- code back in the RETURNING clause.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_partner_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.partner_code IS NULL THEN
    NEW.partner_code := public.generate_partner_code(NEW.category);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partners_assign_partner_code ON public.partners;
CREATE TRIGGER partners_assign_partner_code
    BEFORE INSERT ON public.partners
    FOR EACH ROW EXECUTE FUNCTION public.assign_partner_code();

-- ------------------------------------------------------------
-- 5. Immutability
--
-- Note this deliberately does NOT re-derive the prefix when
-- `category` changes. A clinic re-categorised as a hospital keeps
-- WOS-CLN-0007 — the code identifies the business, not its current
-- category, and every document already issued under the old code
-- stays valid. Same append-only reasoning as mou_signatures (099),
-- just enforced per-column instead of per-row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_partner_code_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.partner_code IS NOT NULL
     AND NEW.partner_code IS DISTINCT FROM OLD.partner_code THEN
    RAISE EXCEPTION 'partner_code_is_immutable'
      USING DETAIL = format(
        'partner_code %s cannot be changed (attempted: %s) — it appears on issued documents',
        OLD.partner_code, NEW.partner_code);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partners_prevent_partner_code_change ON public.partners;
CREATE TRIGGER partners_prevent_partner_code_change
    BEFORE UPDATE OF partner_code ON public.partners
    FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_code_change();

COMMIT;

-- ------------------------------------------------------------
-- Sanity checks after applying:
-- ------------------------------------------------------------
-- 1. Every partner has a code, all distinct:
--   SELECT count(*) AS total,
--          count(partner_code) AS coded,
--          count(DISTINCT partner_code) AS distinct_codes
--   FROM public.partners;
--   -- expect all three equal
--
-- 2. Codes read sensibly per category:
--   SELECT partner_code, name, category FROM public.partners ORDER BY partner_code;
--
-- 3. Immutability actually bites (run in a transaction you roll back):
--   UPDATE public.partners SET partner_code = 'WOS-XXX-9999'
--   WHERE id = (SELECT id FROM public.partners LIMIT 1);
--   -- expect: ERROR: partner_code_is_immutable
