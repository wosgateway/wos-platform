-- ============================================================
-- 033_private_payment_slips.sql
--
-- Fixes HIGH 4 from the security review: `payment-slips` (migration
-- 019) was created as a PUBLIC bucket with a "select using
-- (bucket_id = 'payment-slips')" policy — meaning anyone who guesses
-- or leaks a slip URL can view someone else's bank transfer slip
-- (name, amount, account number, transaction reference, QR/payment
-- info). Slips should never be publicly readable.
--
-- REVISED from the first pass of this migration: a follow-up review
-- correctly pointed out that `service_role` bypasses RLS entirely in
-- Supabase, so the extra "service_role can read" SELECT policy this
-- migration originally added was a no-op — it granted nothing
-- service_role didn't already have, and just added noise that could
-- be misread as "this is what makes signed URLs work" (it isn't;
-- service_role's RLS bypass is what does). Removed.
--
-- Also folds in part of MEDIUM 1 from the original review while this
-- migration already has the bucket open: caps uploaded slips to
-- images/PDF and 10MB, using Supabase Storage's built-in bucket-level
-- `allowed_mime_types` / `file_size_limit` rather than hand-rolling a
-- check in an RLS policy. Anonymous INSERT (upload) is intentionally
-- left open — the customer payment page (my-trip/[orderNumber]/payment)
-- has no login step by design (token-in-link is the access control),
-- so requiring an authenticated Storage session would break that flow.
-- Restricting who can upload beyond type/size is a product decision
-- (would mean adding real customer auth), not a one-line policy fix —
-- flagging as a separate follow-up, not folded in here.
--
-- This migration:
--   1. Flips the bucket to private.
--   2. Caps allowed mime types and file size on the bucket.
--   3. Drops the public SELECT policy. No replacement SELECT policy
--      is added — service_role (used by every admin/partner API
--      route via createServiceClient()) already bypasses RLS, so
--      createSignedUrl() calls from those routes keep working with
--      no policy needed. Anon/authenticated get no way to SELECT
--      objects directly anymore; they can only ever see a slip via a
--      signed URL your server explicitly generates.
--
-- ⚠️ APP-CODE CHANGE REQUIRED ALONGSIDE THIS MIGRATION — already
-- shipped in the same patch set as this file:
--   - src/lib/storage/signed-slip-url.ts (new) — generates signed
--     URLs server-side from the stored (now-dead) public URL.
--   - src/app/api/admin/orders/[id]/route.ts — the only route that
--     renders slips (via admin/orders/[orderId]/page.tsx) now calls
--     attachSignedSlipUrls() before returning payments.
--   - src/app/api/admin/orders/route.ts (list view) — drops slip_url
--     entirely from its response instead, since nothing renders it
--     there and generating a signed URL per payment on every list
--     page load would be wasted Storage calls.
-- Do not deploy this migration ahead of that code, or admin slip
-- viewing breaks immediately (raw public URLs will 400).
--
-- Safe to re-run.
-- ============================================================

update storage.buckets
set public = false,
    file_size_limit = 10485760, -- 10 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
where id = 'payment-slips';

drop policy if exists "Anyone can view payment slips" on storage.objects;

-- No replacement SELECT policy: service_role bypasses RLS, which is
-- exactly the access pattern signed URLs need (server-side only, via
-- createServiceClient()). Anon/authenticated intentionally get zero
-- SELECT access — the whole point of this migration.

-- Upload (INSERT) policy from migration 019 is untouched — anon can
-- still upload new slips; the bucket-level mime/size caps above now
-- apply to those uploads. See header for why upload access itself
-- isn't restricted further here.
