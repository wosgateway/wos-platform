-- ============================================================
-- 114_mou_sign_request_lifecycle.sql
--
-- CONTEXT — three dead states in the MOU flow:
--
-- 1. `cancelled` has been a legal status since 099 and there has
--    never been a way to reach it. An admin who sends an MOU to the
--    wrong signer, or to a contact who has since left the clinic,
--    has no way to invalidate that link — it stays live for the
--    full 14-day TTL (SIGN_LINK_TTL_DAYS).
--
-- 2. `expired` is likewise never written by anything. Nothing
--    sweeps. PartnersManager.tsx compensates by comparing
--    token_expires_at against Date.now() in the browser, which is
--    fine for a badge and wrong for everything else: every
--    server-side query, export and future report sees a two-month-
--    old dead request as still 'pending'.
--
-- 3. Re-sending means creating a second request for the same
--    organization with no link between the two, so the audit trail
--    reads as two independent invitations rather than one that
--    replaced another.
--
-- This migration adds the columns and the two functions those three
-- operations need; the API routes that call them are in the same
-- patch (cancel/, resend/, and /api/cron/expire-mou-sign-requests).
--
-- WHY FUNCTIONS AND NOT PLAIN UPDATES FROM THE ROUTE:
--   Both transitions have a precondition that must be checked in
--   the same statement that performs the write, or it races: a
--   request can be signed between the route's SELECT and its
--   UPDATE, and cancelling or expiring an already-signed MOU would
--   invalidate a real signature that legally exists. Same
--   compare-and-swap reasoning as the lead claim in
--   /api/admin/partners/provision — the WHERE clause is the lock.
--
-- mou_signatures is untouched: append-only, and a cancelled or
-- expired REQUEST never had a signature row to begin with (the
-- unique index on sign_request_id is what guarantees that).
--
-- Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Provenance columns
-- ------------------------------------------------------------
ALTER TABLE public.mou_sign_requests
    ADD COLUMN IF NOT EXISTS cancelled_by UUID,
    ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
    ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS superseded_by_id UUID;

-- FKs added separately + idempotently: ADD COLUMN IF NOT EXISTS
-- can't carry a REFERENCES clause safely on re-run.
--
-- cancelled_by -> users(id), matching the fix 110 applied to
-- created_by (which pointed at the wrong table in 099).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mou_sign_requests_cancelled_by_fkey'
  ) THEN
    ALTER TABLE public.mou_sign_requests
      ADD CONSTRAINT mou_sign_requests_cancelled_by_fkey
      FOREIGN KEY (cancelled_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mou_sign_requests_superseded_by_fkey'
  ) THEN
    ALTER TABLE public.mou_sign_requests
      ADD CONSTRAINT mou_sign_requests_superseded_by_fkey
      FOREIGN KEY (superseded_by_id) REFERENCES public.mou_sign_requests(id) ON DELETE SET NULL;
  END IF;
END;
$$;

COMMENT ON COLUMN public.mou_sign_requests.superseded_by_id IS
    'The request that replaced this one when an admin re-sent the MOU. Makes "this partner was invited three times" readable as one chain rather than three unrelated rows.';

-- Sweep index: only the rows the expiry job ever looks at.
CREATE INDEX IF NOT EXISTS idx_mou_sign_requests_pending_expiry
    ON public.mou_sign_requests(token_expires_at)
    WHERE status IN ('pending', 'otp_verified');

-- ------------------------------------------------------------
-- 2. cancel_mou_sign_request()
--
-- Refuses to touch a request that is already signed — that's the
-- whole point of doing this in one statement. Returns the affected
-- row so the route can report what actually happened instead of
-- assuming.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_mou_sign_request(
    p_sign_request_id UUID,
    p_cancelled_by UUID,
    p_reason TEXT
)
RETURNS public.mou_sign_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mou_sign_requests;
  v_current TEXT;
BEGIN
  UPDATE public.mou_sign_requests
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = p_cancelled_by,
      cancel_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
      updated_at = now()
  WHERE id = p_sign_request_id
    AND status IN ('pending', 'otp_verified')  -- the lock
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  -- Nothing updated: either the id is wrong, or the request is in a
  -- state that must not be cancelled. Distinguish the two so the
  -- admin gets a useful message.
  SELECT status INTO v_current
  FROM public.mou_sign_requests WHERE id = p_sign_request_id;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'sign_request_not_found' USING ERRCODE = 'WS004';
  END IF;

  RAISE EXCEPTION 'sign_request_not_cancellable'
    USING ERRCODE = 'WS005',
          DETAIL  = format('current status is %s', v_current),
          HINT    = CASE v_current
                      WHEN 'signed' THEN 'ลงนามไปแล้ว — ยกเลิกคำขอไม่ได้ ต้องออกเอกสารยกเลิก/ฉบับแก้ไขแทน'
                      ELSE 'คำขอนี้ปิดไปแล้ว'
                    END;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_mou_sign_request(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_mou_sign_request(UUID, UUID, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 3. expire_stale_mou_sign_requests()
--
-- Idempotent sweep — safe to call as often as the scheduler likes;
-- a second run in the same minute updates zero rows. Returns the
-- count so the cron route can log something meaningful.
--
-- `status IN ('pending','otp_verified')` matters: a partner who
-- verified their OTP but never finished signing is still an
-- unsigned request and its token must die on schedule like any
-- other. A signed one is never touched.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_mou_sign_requests()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE public.mou_sign_requests
    SET status = 'expired',
        expired_at = now(),
        updated_at = now()
    WHERE status IN ('pending', 'otp_verified')
      AND token_expires_at < now()
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_mou_sign_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_mou_sign_requests() TO service_role;

COMMIT;

-- ------------------------------------------------------------
-- Sanity checks after applying:
-- ------------------------------------------------------------
-- 1. Backlog the first sweep will clear:
--   SELECT count(*) FROM public.mou_sign_requests
--   WHERE status IN ('pending','otp_verified') AND token_expires_at < now();
--
-- 2. Run it:
--   SELECT public.expire_stale_mou_sign_requests();
--   -- expect: the number above; a second call returns 0
--
-- 3. A signed request cannot be cancelled:
--   SELECT public.cancel_mou_sign_request(
--     (SELECT id FROM public.mou_sign_requests WHERE status='signed' LIMIT 1),
--     NULL, 'test');
--   -- expect: ERROR sign_request_not_cancellable
