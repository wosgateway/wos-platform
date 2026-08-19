-- ============================================================
-- 020b_add_pending_verification_status.sql
--
-- Run this BEFORE 021_payment_security_fixes.sql.
--
-- orders.status has a CHECK constraint (chk_order_status) that does
-- NOT currently allow 'pending_verification' €” confirmed directly
-- from the live constraint definition:
--
--   CHECK ((status = ANY (ARRAY['draft','pending_deposit',
--     'deposit_paid','confirmed','checked_in','completed',
--     'cancelled','refunded'])))
--
-- 021's payments/route.ts sets order.status = 'pending_verification'
-- when a customer submits a slip (replacing the old bug where it
-- reused 'deposit_paid' for both "submitted, unverified" and
-- "verified, partial"). Without this migration, that INSERT/UPDATE
-- will fail with a constraint violation the first time a real
-- customer submits a slip.
--
-- Safe to re-run.
-- ============================================================

alter table public.orders
  drop constraint if exists chk_order_status;

alter table public.orders
  add constraint chk_order_status
  check (
    status = any (
      array[
        'draft',
        'pending_deposit',
        'pending_verification',  -- NEW: slip submitted, awaiting admin verify
        'deposit_paid',
        'confirmed',
        'checked_in',
        'completed',
        'cancelled',
        'refunded'
      ]::text[]
    )
  );

-- ------------------------------------------------------------
-- Also check any admin-UI code (e.g. a status badge/label map,
-- filter dropdown, or ALLOWED_STATUSES array in TypeScript) that
-- enumerates these same 8 statuses €” it needs 'pending_verification'
-- added too, or that status will render blank / fall into an
-- "unknown" bucket in the dashboard. This migration only fixes the
-- database side.
-- ------------------------------------------------------------
