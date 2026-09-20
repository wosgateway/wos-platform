-- ============================================================
-- 080_partner_images_allow_svg_logo.sql
--
-- Found while wiring the new admin upload route
-- (src/app/api/admin/partners/upload-image/route.ts): the logo file
-- input in PartnersManager.tsx has always accepted
-- `image/png,image/svg+xml,image/webp`, but 059's bucket-level
-- `allowed_mime_types` for `partner-images` only ever listed
-- jpeg/png/webp/gif — no svg. Previously this was masked by the RLS
-- 403 happening first on every admin upload; once that's fixed, an
-- admin picking an actual .svg logo would immediately hit a new,
-- confusing bucket-level rejection instead. Partner-facing
-- CompanyProfile.tsx's cover/logo inputs don't accept svg, so this
-- only affects the admin logo flow.
--
-- Safe to re-run.
-- ============================================================

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml'
]
WHERE id = 'partner-images';

-- ============================================================
-- VERIFY after running:
--
--   SELECT id, allowed_mime_types FROM storage.buckets WHERE id = 'partner-images';
--
-- Expected: five entries, including image/svg+xml.
-- ============================================================
