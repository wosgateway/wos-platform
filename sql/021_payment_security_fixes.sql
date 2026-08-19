-- ============================================================
-- 021_payment_security_fixes.sql
--
-- Fixes 2 issues that can't be fixed in application code alone:
--
--   1. GET/POST /api/quote/[orderNumber]/payments currently trusts
--      `order_number` as if it were a secret. It isn't €” it's a
--      predictable sequence (see generate_order_number(): 'WOS-' ||
--      YYYYMMDD || '-' || zero-padded sequence number). Anyone can
--      enumerate it and read/pay against someone else's order.
--      Fix: a random, unguessable `payment_access_token` per order,
--      required alongside order_number for the payments endpoints.
--
--   2. Nothing stops a customer submitting multiple slips for the
--      same order while one is still `waiting_verification` (double
--      counting risk if an admin verifies more than one). App-level
--      checks can still race under concurrent requests, so this is
--      enforced with a partial unique index €” the database itself
--      refuses a second pending whole-order payment.
--
-- Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. payment_access_token
-- ------------------------------------------------------------
alter table public.orders
  add column if not exists payment_access_token text;

-- Backfill existing orders that predate this column.
-- encode(gen_random_bytes(24), 'hex') -> 48 hex chars, URL-safe as-is
-- (no + / = characters to worry about, unlike base64).
update public.orders
set payment_access_token = encode(gen_random_bytes(24), 'hex')
where payment_access_token is null;

alter table public.orders
  alter column payment_access_token set default encode(gen_random_bytes(24), 'hex');

alter table public.orders
  alter column payment_access_token set not null;

drop index if exists orders_payment_access_token_idx;
create unique index orders_payment_access_token_idx
  on public.orders (payment_access_token);

comment on column public.orders.payment_access_token is
  'Random token required (alongside order_number) to read/submit against this order''s payments endpoint. order_number itself is a predictable sequence and must not be treated as a secret €” see migration 021 header.';

-- ------------------------------------------------------------
-- 2. DB-level guard: only one pending whole-order payment at a time
-- ------------------------------------------------------------
-- order_item_id is null => "whole-order" payment (the customer-facing
-- Payment/Upload Slip flow). Partner-scoped payments (order_item_id
-- set) are a different flow and are NOT restricted by this index.
drop index if exists payments_one_pending_whole_order_idx;
create unique index payments_one_pending_whole_order_idx
  on public.payments (order_id)
  where order_item_id is null and status = 'waiting_verification';

-- ------------------------------------------------------------
-- š ï¸ MANUAL STEP €” check this before deploying
-- ------------------------------------------------------------
-- If public.orders.status has a CHECK constraint or enum type
-- restricting which values are allowed, it must be updated to permit
-- the new status 'pending_verification' introduced in the app-code
-- fix that goes with this migration (see payments/route.ts) €” this
-- replaces the old bug where a freshly-submitted, NOT YET verified
-- payment set order.status = 'deposit_paid', the same value used for
-- a verified partial payment. Run this to check what you have:
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.orders'::regclass and contype = 'c';
--
-- If a constraint exists and doesn't already allow
-- 'pending_verification', update it (example €” adjust to your actual
-- constraint/enum):
--
--   alter table public.orders drop constraint orders_status_check;
--   alter table public.orders add constraint orders_status_check
--     check (status in ('draft','pending_deposit','pending_verification',
--                        'deposit_paid','confirmed','checked_in',
--                        'completed','cancelled','refunded'));
--
-- Also update any ALLOWED_STATUSES list in admin UI code that
-- enumerates order statuses, so 'pending_verification' displays
-- correctly instead of falling through to an "unknown status" case.
