-- ============================================================
-- 115_fix_mou_cancelled_by_fk.sql
--
-- Fix Admin identity reference for MOU cancellation.
-- cancelled_by receives auth.users.id from requireAdmin().
-- ============================================================

BEGIN;

ALTER TABLE public.mou_sign_requests
  DROP CONSTRAINT IF EXISTS mou_sign_requests_cancelled_by_fkey;

ALTER TABLE public.mou_sign_requests
  ADD CONSTRAINT mou_sign_requests_cancelled_by_fkey
  FOREIGN KEY (cancelled_by)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

COMMIT;