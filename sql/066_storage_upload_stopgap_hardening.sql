-- ============================================================
-- 066_storage_upload_stopgap_hardening.sql
--
-- Finding (STEP 1 audit): both `payment-slips` and
-- `booking-attachments` allow anonymous INSERT into storage.objects
-- with NO with_check at all beyond bucket_id -- confirmed still true
-- in the live pg_policies dump. `booking-attachments` is the more
-- severe of the two (migration 044: holds customer medical
-- documents/results).
--
-- IMPORTANT -- what this migration does and does NOT fix:
--   This is a stopgap, not the real fix. A storage RLS `with_check`
--   only ever sees the new row's `bucket_id`/`name` (path) -- it has
--   no access to the `payment_access_token` query param the app
--   already uses to prove order ownership elsewhere. And
--   orders.order_number is sequence-generated (generate_order_number(),
--   migration 005/008) -- sequential, not a secret -- so knowing/
--   guessing a real order_number is trivial. That means even after
--   this migration, someone who enumerates order numbers can still
--   upload a decoy slip into another customer's real, still-open
--   order folder. Closing that requires moving the upload itself
--   behind a signed-upload-URL route that checks payment_access_token
--   server-side before minting the URL -- a code change to the
--   customer-facing payment/booking pages, not something to ship
--   silently in a SQL migration. Flagging as the real follow-up, not
--   doing it in this file.
--
--   For booking-attachments the gap is worse: the upload happens
--   BEFORE the order exists, so there is no order row to check
--   ownership against at all yet at the DB layer. The real fix there
--   is moving the attachment upload to happen server-side (via
--   service_role) as part of order creation, after the order_number
--   exists, rather than client-side beforehand. Also not done here.
--
-- What THIS migration narrows, safely, with no code change needed:
--   1. payment-slips: path's order-number segment must reference an
--      order that actually exists and isn't already closed
--      (completed/cancelled/refunded) -- cuts off spam into orders
--      that no longer accept payments, and pure junk paths unrelated
--      to any real order.
--   2. booking-attachments: path must match the exact
--      `<uuid>-<filename>` shape the app always generates
--      (BookingForm.tsx / JourneyBookingForm.tsx) -- blocks arbitrary
--      path structures (e.g. path traversal-shaped names, nested
--      folders) even though it can't tie the file to an order yet.
-- ============================================================

DROP POLICY IF EXISTS "Anyone can upload payment slips" ON storage.objects;

CREATE POLICY "Anyone can upload payment slips" ON storage.objects
FOR INSERT
TO public
WITH CHECK (
    bucket_id = 'payment-slips'
    AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.order_number = (storage.foldername(name))[1]
          AND o.status NOT IN ('completed', 'cancelled', 'refunded')
    )
);

DROP POLICY IF EXISTS "anon_upload_booking_attachments" ON storage.objects;

CREATE POLICY "anon_upload_booking_attachments" ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
    bucket_id = 'booking-attachments'
    -- <uuid>-<original filename>, matches the path BookingForm.tsx /
    -- JourneyBookingForm.tsx always generate via crypto.randomUUID()
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-.+$'
);

-- Sanity check after applying, expected: both policies present with
-- the new with_check (not null / not just bucket_id anymore)
--
-- select policyname, with_check
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and policyname in ('Anyone can upload payment slips', 'anon_upload_booking_attachments');
