-- ============================================================
-- 068_payment_slips_drop_anon_upload_policy.sql
--
-- Follow-up to 066's stopgap. As of the accompanying code change
-- (new route src/app/api/quote/[orderNumber]/upload-slip-url/route.ts
-- + my-trip/[orderNumber]/payment/page.tsx switched to
-- uploadToSignedUrl()), the client no longer uploads to `payment-slips`
-- directly at all. Every upload now requires a signed upload token
-- minted by that route, which only happens after it verifies `token`
-- against this order's payment_access_token server-side -- the check
-- storage RLS could never do on its own (order_number is a predictable
-- sequence, not a secret; see generate_order_number()).
--
-- Deploy together with the route + page changes (same rule as 060/065):
-- once this runs, the OLD client code path (direct
-- `.storage.from('payment-slips').upload(...)`) starts failing with a
-- permissions error, so it must not still be live in production when
-- this migration runs.
-- ============================================================

DROP POLICY IF EXISTS "Anyone can upload payment slips" ON storage.objects;

-- Signed upload URLs (createSignedUploadUrl / uploadToSignedUrl) carry
-- their own bearer token and don't need a matching INSERT policy to
-- work -- they authenticate via the token itself, not via anon/authenticated
-- RLS. No replacement policy is needed or added.

-- Sanity check after applying, expected: 0 rows
--
-- select policyname
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and policyname = 'Anyone can upload payment slips';
