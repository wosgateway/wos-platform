-- ============================================================
-- 113_mou_gate_and_commission_fallback.sql
--
-- CONTEXT — the two things this closes, and why they are one
-- migration and not two:
--
-- GAP A — commission charged without a signed agreement.
--   calculate_order_item_commission() (098, refined 101/103) ends in
--   `v_rate := COALESCE(v_rate, 12.00)`. That means an order_item
--   assigned to a partner who has NO partner_commercial_terms row,
--   and who has never signed anything, still gets a commission
--   computed at the MOU default and flows into settlement as if it
--   were agreed. 098's design decision 3 accepted this knowingly
--   ("fails soft to the MOU default rather than blocking a booking")
--   at a time when every partner in the system predated the MOU
--   flow and the alternative was blocking live bookings. 101's
--   header then explicitly deferred closing it: "turn 'no active
--   term' into a hard block instead of a silent default ... tracked
--   as its own follow-up migration once the order_items snapshot
--   work lands". 102 and 103 have landed. This is that follow-up.
--
-- GAP B — nothing anywhere requires an MOU before a partner can
--   transact. /api/admin/partners/provision creates a live,
--   bookable partner (status 'active') and a portal login in one
--   call; the MOU sign request is a separate button an admin may or
--   may not press afterwards. So "signed the MOU" is currently
--   documentation, not a precondition.
--
-- They are one migration because they are one decision applied at
-- one place: the commission trigger is the single chokepoint every
-- partner-assigned order_item passes through (bookings via
-- create_order_with_items, admin assignment via
-- admin_assign_order_item, and any manual fix-up UPDATE). Gating
-- there catches all three without touching any of the six
-- migrations that have edited admin_assign_order_item over time.
--
-- WHAT IS DELIBERATELY *NOT* GATED — portal login:
--   A partner can still log in, complete their profile, upload
--   documents and read the MOU before signing it. Blocking login
--   until signature would mean asking people to sign an agreement
--   with a platform they have not been allowed to look at. The gate
--   is on transacting (being assigned paid work / being charged
--   commission), not on access.
--
-- ⚠️ GRANDFATHERING — READ BEFORE APPLYING:
--   Every partner that exists today predates this rule. Turning the
--   gate on unconditionally would block assignment for all of them
--   the moment this runs. So `partners.mou_exempt` is added and
--   backfilled TRUE for existing rows only; the trigger skips the
--   MOU check for exempt partners. New partners (inserted after
--   this migration) default to FALSE and are gated for real.
--   mou_exempt is a migration aid with an expiry date, not a
--   feature — the intended end state is zero exempt partners. See
--   the review query at the bottom of this file.
--
--   The RATE check (GAP A) is NOT exempted for anyone: every
--   existing partner already has a terms row from 098's step-4
--   backfill, so a hard block breaks nothing today, and a partner
--   provisioned after this runs must have a rate set before their
--   first assignment — which is the correct order of operations
--   anyway (agree the commercial terms, then book work against
--   them).
--
-- Idempotent — safe to re-run, same convention as the rest of /sql.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. partners.mou_exempt — the grandfather flag
-- ------------------------------------------------------------
ALTER TABLE public.partners
    ADD COLUMN IF NOT EXISTS mou_exempt BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.partners.mou_exempt IS
    'TRUE = this partner may be assigned paid work without a signed MOU on file. Backfilled TRUE by migration 113 for partners that predate the MOU gate; FALSE for everyone created after. This is a temporary migration aid — the target state is zero exempt partners. Never set TRUE for a new partner to "unblock" an assignment; set their commercial terms and get the MOU signed instead.';

-- Backfill: only rows that existed before this migration ran. The
-- DEFAULT above is false, so anything inserted afterwards is gated.
UPDATE public.partners SET mou_exempt = true WHERE mou_exempt = false;

-- ------------------------------------------------------------
-- 2. partner_mou_signed_at() — "has this partner signed, and when"
--
-- mou_signatures is keyed by organization_id, partners by id, and
-- the link between them is NOT a single column: some organizations
-- carry partner_id directly, others only reach it via
-- branches.partner_id (the dual-linkage reality documented in
-- src/app/api/admin/mou/sign-requests/route.ts's correction note
-- and portal-accounts/route.ts). Both paths are checked here so
-- this function can't silently report "never signed" for a partner
-- whose org was created under the older path.
--
-- Returns the EARLIEST signature (when the relationship became
-- contractual), not the latest — a later amendment does not change
-- when the partner came under agreement.
--
-- SECURITY DEFINER: mou_signatures has no policy for anyone except
-- platform admins, and this function is called from a trigger that
-- runs in whatever role created the order_item (often the partner's
-- own session, or anon via create_order_with_items). It must be
-- able to answer yes/no without exposing the signature rows
-- themselves — it returns only a timestamp, never signer identity,
-- IP, or document path.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_mou_signed_at(p_partner_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT MIN(ms.signed_at)
  FROM public.mou_signatures ms
  WHERE ms.organization_id IN (
      SELECT o.id FROM public.organizations o WHERE o.partner_id = p_partner_id
      UNION
      SELECT b.organization_id FROM public.branches b
      WHERE b.partner_id = p_partner_id AND b.organization_id IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.partner_mou_signed_at(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_mou_signed_at(UUID)
    TO authenticated, anon, service_role;

-- ------------------------------------------------------------
-- 3. The gate — commission trigger, third revision
--
-- Diff vs 103, which is otherwise preserved verbatim (NULL handling
-- for unassigned items, partner_balance as the base, snapshot
-- written in the same statement as the amount):
--
--   + hard error when the partner has no signed MOU and is not
--     grandfathered
--   - COALESCE(v_rate, 12.00)  ->  hard error when no active term
--
-- Both errors carry a SQLSTATE in the 'WOS' custom class so the API
-- layer can map them to a friendly Thai message instead of leaking
-- a raw Postgres string to an admin. Postgres reserves classes
-- starting with 0-4/A-H for itself; 'WS' + digits is safely in user
-- territory.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_order_item_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate NUMERIC(5,2);
  v_partner_balance NUMERIC(12,2);
  v_exempt BOOLEAN;
  v_signed_at TIMESTAMPTZ;
  v_partner_label TEXT;
BEGIN
  -- partner_balance is GENERATED on this row and isn't available
  -- inside a BEFORE trigger, so it's recomputed from the same two
  -- source columns 102 uses. (Unchanged from 103.)
  IF NEW.price IS NULL OR NEW.deposit_required IS NULL THEN
    v_partner_balance := NULL;
  ELSE
    v_partner_balance := NEW.price - NEW.deposit_required;
  END IF;

  -- Unassigned / not-yet-priced line: no partner, no commission, no
  -- gate to apply. "ให้ทีมงานเลือกให้" items must stay insertable —
  -- gating them would block the customer-facing booking form for
  -- items that have no partner attached yet. (Unchanged from 103.)
  IF v_partner_balance IS NULL OR NEW.partner_id IS NULL THEN
    NEW.commission_rate_snapshot := NULL;
    NEW.commission_amount := NULL;
    RETURN NEW;
  END IF;

  SELECT p.mou_exempt, COALESCE(p.partner_code, p.name)
    INTO v_exempt, v_partner_label
  FROM public.partners p
  WHERE p.id = NEW.partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found'
      USING ERRCODE = 'WS001',
            DETAIL  = format('order_items.partner_id %s does not exist', NEW.partner_id);
  END IF;

  -- GAP B — the MOU gate.
  IF NOT COALESCE(v_exempt, false) THEN
    v_signed_at := public.partner_mou_signed_at(NEW.partner_id);
    IF v_signed_at IS NULL THEN
      RAISE EXCEPTION 'partner_mou_not_signed'
        USING ERRCODE = 'WS002',
              DETAIL  = format('partner %s has no signed MOU on file', v_partner_label),
              HINT    = 'ส่ง MOU ให้พันธมิตรลงนามก่อน จึงจะมอบหมายงานที่มีค่าบริการให้ได้';
    END IF;
  END IF;

  -- GAP A — no more silent 12% fallback.
  SELECT commercial_fee_rate INTO v_rate
  FROM public.partner_commercial_terms
  WHERE partner_id = NEW.partner_id
    AND effective_from <= now()
    AND (effective_until IS NULL OR effective_until > now())
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'partner_commercial_terms_missing'
      USING ERRCODE = 'WS003',
            DETAIL  = format('partner %s has no active commercial term as of now()', v_partner_label),
            HINT    = 'ตั้งอัตราค่าบริการ (partner_commercial_terms) ให้พันธมิตรรายนี้ก่อน';
  END IF;

  NEW.commission_rate_snapshot := v_rate;
  NEW.commission_amount := ROUND(v_partner_balance * v_rate / 100, 2);

  RETURN NEW;
END;
$$;

-- Trigger binding unchanged from 103 (BEFORE INSERT OR UPDATE OF
-- price, deposit_required, partner_id) — only the function body
-- changed, so no DROP/CREATE TRIGGER here.

-- ------------------------------------------------------------
-- 4. Admin-facing onboarding status
--
-- One row per partner answering "can this partner actually take
-- paid work yet, and if not, what's missing" — the thing an admin
-- currently has to piece together from three different tabs.
--
-- A function, not a view: it reads partner_commercial_terms and
-- mou_signatures, both of which are deliberately admin-only at the
-- RLS level (098, 099). A plain view would run as the caller and
-- return empty rows for anyone else, which is a confusing failure
-- mode; this fails loudly at the GRANT instead — only the
-- service-role admin routes can call it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_partner_onboarding_status()
RETURNS TABLE (
    partner_id UUID,
    partner_code TEXT,
    partner_name TEXT,
    category TEXT,
    partner_status TEXT,
    mou_exempt BOOLEAN,
    mou_signed_at TIMESTAMPTZ,
    active_fee_rate NUMERIC(5,2),
    active_rate_since TIMESTAMPTZ,
    ready_for_assignment BOOLEAN,
    blocking_reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.partner_code,
    p.name,
    p.category,
    p.status,
    p.mou_exempt,
    public.partner_mou_signed_at(p.id)                         AS mou_signed_at,
    t.commercial_fee_rate                                       AS active_fee_rate,
    t.effective_from                                            AS active_rate_since,
    (t.commercial_fee_rate IS NOT NULL
      AND (p.mou_exempt OR public.partner_mou_signed_at(p.id) IS NOT NULL))
                                                                AS ready_for_assignment,
    CASE
      WHEN t.commercial_fee_rate IS NULL
       AND NOT p.mou_exempt
       AND public.partner_mou_signed_at(p.id) IS NULL THEN 'ยังไม่ได้ลงนาม MOU และยังไม่ได้ตั้งอัตราค่าบริการ'
      WHEN t.commercial_fee_rate IS NULL                  THEN 'ยังไม่ได้ตั้งอัตราค่าบริการ'
      WHEN NOT p.mou_exempt
       AND public.partner_mou_signed_at(p.id) IS NULL     THEN 'ยังไม่ได้ลงนาม MOU'
      ELSE NULL
    END                                                         AS blocking_reason
  FROM public.partners p
  LEFT JOIN LATERAL (
    SELECT pct.commercial_fee_rate, pct.effective_from
    FROM public.partner_commercial_terms pct
    WHERE pct.partner_id = p.id
      AND pct.effective_from <= now()
      AND (pct.effective_until IS NULL OR pct.effective_until > now())
    ORDER BY pct.effective_from DESC
    LIMIT 1
  ) t ON true
  ORDER BY p.partner_code;
$$;

REVOKE ALL ON FUNCTION public.get_partner_onboarding_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_onboarding_status() TO service_role;

COMMIT;

-- ------------------------------------------------------------
-- Sanity checks after applying:
-- ------------------------------------------------------------
-- 1. Who is grandfathered, and who is actually blocked right now:
--   SELECT partner_code, partner_name, mou_exempt, mou_signed_at,
--          active_fee_rate, ready_for_assignment, blocking_reason
--   FROM public.get_partner_onboarding_status();
--   -- expect: every pre-existing partner mou_exempt = true and
--   -- ready_for_assignment = true (098 gave them all a terms row)
--
-- 2. The gate bites for a genuinely new partner (roll this back):
--   BEGIN;
--   INSERT INTO public.partners (name, category, status)
--   VALUES ('Gate test', 'Clinic', 'active');
--   -- then assign an order_item to it: expect ERROR WS002/WS003
--   ROLLBACK;
--
-- 3. Existing commissions are untouched — this migration changes no
--    data, only future writes:
--   SELECT count(*) FILTER (WHERE commission_amount IS NOT NULL),
--          COALESCE(SUM(commission_amount), 0)
--   FROM public.order_items;
--   -- compare against the same query run before applying
--
-- ------------------------------------------------------------
-- The exemption burn-down — run this monthly until it returns 0:
-- ------------------------------------------------------------
--   SELECT partner_code, name
--   FROM public.partners
--   WHERE mou_exempt AND public.partner_mou_signed_at(id) IS NULL
--   ORDER BY partner_code;
--
-- For each row: send the MOU, and once signed:
--   UPDATE public.partners SET mou_exempt = false WHERE id = '...';
