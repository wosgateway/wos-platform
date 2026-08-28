-- ============================================================
-- 059_partner_images_bucket_limits_and_path_fix.sql
--
-- Two real bugs found in a review of partner-facing image upload
-- (CompanyProfile.tsx logo/cover + PackagesManager.tsx package photo),
-- both in the `partner-images` bucket set up by
-- 003_storage_bucket_partner_images.sql:
--
-- 1. The bucket has never had `file_size_limit` / `allowed_mime_types`
--    set at the Storage level. CompanyProfile.tsx enforces "5MB,
--    images only" itself before calling `.upload()`, but that's a
--    browser-side check only — an authenticated partner calling the
--    Storage REST API directly (skipping the app's UI/JS entirely)
--    can still write an arbitrarily large or non-image file into
--    their own org's folder. The RLS policies from 003 correctly stop
--    them from writing into *another* org's folder, but nothing stops
--    an oversized/wrong-type file in their own. This mirrors the fix
--    044_storage_rls_hardening.sql already applied to
--    `booking-attachments` — just never applied here.
--
-- 2. PackagesManager.tsx uploads package photos to
--    `packages/<partner_id>/<filename>` using `branches.partner_id`
--    (a public.partners row id), but the 003 INSERT/UPDATE/DELETE
--    policies check path segment [2] against `organization_id` from
--    public.users. `partner_id` and `organization_id` are different
--    ID spaces (see CompanyProfile.tsx's own comments on
--    PartnersSyncPayload for why they're kept separate) — they will
--    only ever match by coincidence. In practice this means package
--    photo uploads get rejected by RLS (403) essentially every time.
--    Shipped alongside this migration: PackagesManager.tsx and both
--    of its page.tsx callers now pass and use `organizationId`
--    instead, so the path finally matches what the policy expects.
--    This migration does not need to (and cannot, from SQL alone) fix
--    old rows already written under `packages/<partner_id>/...` — see
--    the verification note at the bottom for how to find any.
--
-- Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Bucket-level size + MIME enforcement (matches the 5MB / image
--    rule CompanyProfile.tsx already enforces client-side, and the
--    same pattern 044 used for booking-attachments).
-- ------------------------------------------------------------
UPDATE storage.buckets
SET file_size_limit = 5242880, -- 5MB, matches MAX_UPLOAD_BYTES in CompanyProfile.tsx
    allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ]
WHERE id = 'partner-images';

-- Nothing to change in RLS here — the existing org-scoped
-- insert/update/delete policies from 003 are untouched and still the
-- only way to write to this bucket. This migration only adds a
-- server-side floor under the size/type checks that used to live in
-- the browser alone.

-- ============================================================
-- VERIFY after running:
--
--   SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets
--   WHERE id = 'partner-images';
--
-- Expected: file_size_limit = 5242880, allowed_mime_types = the four
-- image types above.
--
-- Then test:
--   - Upload a >5MB image as a partner via the CompanyProfile logo/
--     cover form -> browser-side check still catches it first (same
--     UX as before), but confirm via curl/Postman with a direct
--     Storage API call + a valid partner session that oversized/
--     wrong-type files now get rejected server-side too (400).
--   - Upload a normal <5MB jpg/png/webp/gif as a partner -> should
--     still succeed exactly as before, for both logo/cover
--     (CompanyProfile.tsx) and package photos (PackagesManager.tsx,
--     once the org_id path fix below is deployed alongside this).
--
-- Find any pre-existing package images stranded under the old,
-- broken `packages/<partner_id>/...` path (won't match any org's
-- folder going forward, so worth a one-time look, not auto-migrated
-- by this file):
--
--   SELECT name FROM storage.objects
--   WHERE bucket_id = 'partner-images' AND name LIKE 'packages/%'
--   ORDER BY created_at DESC;
--
-- Cross-check each `partner_id` segment found there against
-- public.partners to see if any packages.image_url rows need
-- re-pointing at a re-uploaded, correctly-pathed file.
-- ============================================================
