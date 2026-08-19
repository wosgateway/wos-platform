-- ============================================================
-- 019_payment_slip_upload.sql
--
-- Adds what the customer-facing "Payment / Upload Slip" page needs:
--   1. A public storage bucket for slip images/PDFs
--      (same pattern as existing `booking-attachments` bucket used
--      by BookingForm.tsx €” public bucket, anon can INSERT new
--      objects, nobody can UPDATE/DELETE, everyone can SELECT the
--      public URL).
--   2. New columns on `payments` so a slip upload can be recorded
--      without touching the verify/reject routes' existing columns
--      (id, order_id, order_item_id, amount, currency, status,
--      verified_by, verified_at, rejection_reason €” all assumed to
--      already exist from migration 008).
--
-- Run this once against the project (Supabase SQL editor or CLI).
-- Safe to re-run €” every statement is guarded with IF NOT EXISTS /
-- ON CONFLICT DO NOTHING.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Storage bucket
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('payment-slips', 'payment-slips', true)
on conflict (id) do nothing;

-- Anyone (including anon, unauthenticated customers on the public
-- payment page) can upload a slip €” same trust model as
-- `booking-attachments`. Filenames are timestamp-prefixed client-side
-- so collisions/overwrites aren't a practical concern.
drop policy if exists "Anyone can upload payment slips" on storage.objects;
create policy "Anyone can upload payment slips"
  on storage.objects for insert
  with check (bucket_id = 'payment-slips');

-- Public read so admins/partners can view the slip via the stored
-- public URL (no signed URLs needed for MVP).
drop policy if exists "Anyone can view payment slips" on storage.objects;
create policy "Anyone can view payment slips"
  on storage.objects for select
  using (bucket_id = 'payment-slips');

-- Deliberately no UPDATE/DELETE policy €” slips are immutable once
-- uploaded; a resubmission just uploads a new file/new payments row.

-- ------------------------------------------------------------
-- 2. New columns on payments
-- ------------------------------------------------------------
alter table public.payments
  add column if not exists slip_url text,
  add column if not exists method text,               -- 'bank_transfer' | 'qr'
  add column if not exists submitted_at timestamptz default now();

-- order_item_id already nullable per existing verify/reject routes
-- (NULL = whole-order payment, not tied to a single partner's item).
-- No change needed there.

comment on column public.payments.slip_url is
  'Public URL of the uploaded transfer slip in the payment-slips bucket.';
comment on column public.payments.method is
  'Customer-selected payment method: bank_transfer | qr.';
