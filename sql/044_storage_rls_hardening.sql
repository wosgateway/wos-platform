-- ============================================================
-- 044_storage_rls_hardening.sql
--
-- Confirmed against raw `pg_policies` output for storage.objects
-- (not guessed from a paraphrased review — see project history).
--
-- Two unrelated issues, both real, both confirmed:
--
-- 1. partner-images: three untracked policies grant `anon`
--    unscoped INSERT/UPDATE/DELETE on the whole bucket
--    (USING/WITH CHECK is just `bucket_id = 'partner-images'`, no
--    folder/org check at all) — sitting right next to the correctly
--    org-scoped `authenticated` policies from
--    003_storage_bucket_partner_images.sql. Since Postgres OR's
--    permissive policies together, the unscoped anon ones win.
--    These were created outside any tracked migration (Dashboard),
--    so this file removes them explicitly by name.
--
-- 2. booking-attachments: stores customer-uploaded medical
--    documents/test results ("อัปโหลดเอกสาร/ผลตรวจ" in
--    BookingForm.tsx / JourneyBookingForm.tsx) — not marketing
--    images. It was left as a fully public bucket with an unscoped
--    `anon` SELECT policy, and orders.attachment_url stores the raw
--    public URL. This is the exact same shape of bug that
--    033_private_payment_slips.sql already fixed for payment slips
--    — just never applied here, on more sensitive data.
--
-- ⚠️ APP-CODE CHANGE REQUIRED ALONGSIDE THIS MIGRATION (same
-- pattern 033 used) — ship together, do not deploy this ahead of
-- the code:
--   - src/lib/storage/signed-attachment-url.ts (new)
--   - src/app/api/admin/orders/[id]/route.ts — signs attachment_url
--     before returning (single order, admin detail view).
--   - src/app/api/admin/orders/route.ts — signs attachment_url on
--     every row before returning (list view). NOTE: unlike
--     slip_url, this field IS rendered in the list view
--     (BookingsManager.tsx's "📎 ไฟล์แนบ" link), so it's signed here
--     rather than dropped.
-- Deploying the SQL half without the code half breaks admin
-- attachment viewing immediately (raw public URLs will 400/403).
--
-- The partner-facing BookingDetailModal.tsx also references
-- `order.attachment_url`, but /api/partner/orders/route.ts never
-- selects that column today — it's already always undefined there,
-- so no partner-facing code needs to change for this migration to
-- be safe. If partner-visible attachments are wanted later, that
-- route needs the same signed-URL treatment added at that time.
--
-- Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. partner-images: drop the unscoped anon policies
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Allow anon insert to partner-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon update on partner-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon delete on partner-images" ON storage.objects;

-- "Allow public read on partner-images" (public, SELECT) is a
-- harmless duplicate of "partner-images public read" from
-- 003_storage_bucket_partner_images.sql — same bucket_id-only
-- condition, same effect, both public SELECT. Left as-is; dropping
-- it changes nothing security-wise and isn't worth the risk of
-- typo'ing a policy name on a table this size. Clean up opportunistically
-- if you're ever in here for another reason.

-- The org-scoped `authenticated` insert/update/delete policies from
-- 003 are untouched and now the only way to write to this bucket.

-- ------------------------------------------------------------
-- 2. booking-attachments: privatize, same treatment as payment-slips
-- ------------------------------------------------------------
UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'application/pdf'
    ]
WHERE id = 'booking-attachments';

-- No replacement SELECT policy: service_role (used by every
-- admin/partner API route via createServiceClient()) already
-- bypasses RLS, which is exactly the access pattern signed URLs
-- need. Anon/authenticated intentionally get zero SELECT access —
-- the whole point of this migration.

-- Upload (INSERT) policy "anon_upload_booking_attachments" is left
-- untouched, same reasoning 033 gave for payment-slips: the booking
-- form (BookingForm.tsx / JourneyBookingForm.tsx) has no login step
-- by design, so requiring an authenticated Storage session to
-- upload would break that flow. The bucket-level mime/size caps
-- above now apply to those uploads too. Restricting who can upload
-- beyond type/size is a product decision (real customer auth), not
-- a one-line policy fix — same follow-up note as payment-slips.

-- ============================================================
-- VERIFY after running:
--
--   SELECT policyname, roles, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND (qual LIKE '%partner-images%' OR qual LIKE '%booking-attachments%'
--          OR with_check LIKE '%partner-images%' OR with_check LIKE '%booking-attachments%')
--   ORDER BY policyname;
--
-- Expected for partner-images: only "partner-images public read"
-- (public, SELECT), "Allow public read on partner-images" (public,
-- SELECT, harmless dup), and the four "partner-images org-scoped ..."
-- policies (authenticated, org-scoped). No bare `anon` role left.
--
-- Expected for booking-attachments: only
-- "anon_upload_booking_attachments" (anon+authenticated, INSERT,
-- unscoped — intentional). No SELECT policy at all.
--
-- Then test:
--   - Open an existing order's attachment link from the admin
--     BookingsManager list AND from the order detail page — both
--     should load (now via a signed URL, check the URL changed from
--     a plain /object/public/... link to /object/sign/...).
--   - As anon (logged out), try GET on a booking-attachments object
--     URL directly via the REST API -> should now 400/403.
--   - Submit a new booking with an attachment via BookingForm.tsx to
--     confirm anon upload still works.
-- ============================================================
