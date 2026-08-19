-- ============================================================
-- 003_storage_bucket_partner_images.sql
-- ============================================================
-- à¸ªà¸£à¹‰à¸²à¸‡ storage bucket "partner-images" + policy à¸—à¸µà¹ˆà¸‚à¸²à¸”à¹„à¸› (README à¹€à¸”à¸´à¸¡à¸‚à¹‰à¸­ 5)
-- à¸£à¸±à¸™à¸«à¸¥à¸±à¸‡ 001_schema_and_rls.sql à¹à¸¥à¸° 002_missing_rls_policies.sql
--
-- Path convention à¸—à¸µà¹ˆ component à¸ˆà¸£à¸´à¸‡à¹ƒà¸Šà¹‰à¸­à¸¢à¸¹à¹ˆà¹à¸¥à¹‰à¸§ (à¸”à¸¹à¹ƒà¸™ CompanyProfile.tsx /
-- PackagesManager.tsx / DocumentsManager.tsx):
--   organizations/<organization_id>/<timestamp>_<filename>   (à¹‚à¸¥à¹‚à¸à¹‰/à¸£à¸¹à¸›à¸›à¸)
--   packages/<organization_id>/<timestamp>_<filename>        (à¸£à¸¹à¸›à¹‚à¸›à¸£à¹à¸à¸£à¸¡)
--   documents/<organization_id>/<timestamp>_<filename>       (à¹€à¸­à¸à¸ªà¸²à¸£/à¹ƒà¸šà¸­à¸™à¸¸à¸à¸²à¸•)
-- => segment à¸—à¸µà¹ˆ 2 (index 2 à¹ƒà¸™ storage.foldername) à¸„à¸·à¸­ organization_id à¹€à¸ªà¸¡à¸­

-- 1. à¸ªà¸£à¹‰à¸²à¸‡ bucket à¹à¸šà¸š public read (à¸•à¸£à¸‡à¸à¸±à¸šà¸—à¸µà¹ˆ component à¹€à¸£à¸µà¸¢à¸ getPublicUrl())
insert into storage.buckets (id, name, public)
values ('partner-images', 'partner-images', true)
on conflict (id) do nothing;

-- 2. à¸¥à¸š policy à¸Šà¸·à¹ˆà¸­à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸™à¸–à¹‰à¸²à¸¡à¸µà¸­à¸¢à¸¹à¹ˆà¹à¸¥à¹‰à¸§ à¸à¸±à¸™à¸£à¸±à¸™à¸‹à¹‰à¸³ error
drop policy if exists "partner-images public read" on storage.objects;
drop policy if exists "partner-images org-scoped insert" on storage.objects;
drop policy if exists "partner-images org-scoped update" on storage.objects;
drop policy if exists "partner-images org-scoped delete" on storage.objects;

-- 3. Public read: à¹ƒà¸„à¸£à¸à¹‡à¸•à¸²à¸¡à¸—à¸µà¹ˆà¸¡à¸µà¸¥à¸´à¸‡à¸à¹Œà¹€à¸«à¹‡à¸™à¸£à¸¹à¸›/à¹„à¸Ÿà¸¥à¹Œà¹„à¸”à¹‰ (à¸•à¸£à¸‡à¸à¸±à¸š getPublicUrl())
create policy "partner-images public read"
on storage.objects for select
to public
using (bucket_id = 'partner-images');

-- 4. Insert: à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰à¸—à¸µà¹ˆ login à¹à¸¥à¹‰à¸§à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹„à¸”à¹‰à¹€à¸‰à¸žà¸²à¸°à¹‚à¸Ÿà¸¥à¹€à¸”à¸­à¸£à¹Œà¸‚à¸­à¸‡à¸­à¸‡à¸„à¹Œà¸à¸£à¸•à¸±à¸§à¹€à¸­à¸‡à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™
create policy "partner-images org-scoped insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'partner-images'
  and (storage.foldername(name))[2] = (
    select organization_id::text
    from public.users
    where supabase_user_id = auth.uid()
  )
);

-- 5. Update: à¹à¸à¹‰à¹„à¸‚/à¹€à¸‚à¸µà¸¢à¸™à¸—à¸±à¸šà¹„à¸Ÿà¸¥à¹Œà¹„à¸”à¹‰à¹€à¸‰à¸žà¸²à¸°à¹ƒà¸™à¹‚à¸Ÿà¸¥à¹€à¸”à¸­à¸£à¹Œà¸­à¸‡à¸„à¹Œà¸à¸£à¸•à¸±à¸§à¹€à¸­à¸‡
create policy "partner-images org-scoped update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'partner-images'
  and (storage.foldername(name))[2] = (
    select organization_id::text
    from public.users
    where supabase_user_id = auth.uid()
  )
);

-- 6. Delete: à¸¥à¸šà¹„à¸Ÿà¸¥à¹Œà¹„à¸”à¹‰à¹€à¸‰à¸žà¸²à¸°à¹ƒà¸™à¹‚à¸Ÿà¸¥à¹€à¸”à¸­à¸£à¹Œà¸­à¸‡à¸„à¹Œà¸à¸£à¸•à¸±à¸§à¹€à¸­à¸‡
create policy "partner-images org-scoped delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'partner-images'
  and (storage.foldername(name))[2] = (
    select organization_id::text
    from public.users
    where supabase_user_id = auth.uid()
  )
);

-- š ï¸ à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸à¸”à¹‰à¸²à¸™à¸„à¸§à¸²à¸¡à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢ (à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹à¸à¹‰à¹ƒà¸™à¹„à¸Ÿà¸¥à¹Œà¸™à¸µà¹‰ à¹€à¸žà¸£à¸²à¸°à¹€à¸›à¹‡à¸™à¸à¸²à¸£à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ behavior à¹€à¸”à¸´à¸¡):
-- DocumentsManager.tsx à¸­à¸±à¸›à¹‚à¸«à¸¥à¸”à¹€à¸­à¸à¸ªà¸²à¸£/à¹ƒà¸šà¸­à¸™à¸¸à¸à¸²à¸•à¹„à¸›à¸—à¸µà¹ˆ bucket à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸™à¸™à¸µà¹‰à¹à¸¥à¸°à¹€à¸£à¸µà¸¢à¸
-- getPublicUrl() à¹€à¸«à¸¡à¸·à¸­à¸™à¸à¸±à¸™ à¸‹à¸¶à¹ˆà¸‡à¹à¸›à¸¥à¸§à¹ˆà¸²à¹„à¸Ÿà¸¥à¹Œà¹€à¸­à¸à¸ªà¸²à¸£ (à¸­à¸²à¸ˆà¸¡à¸µà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸­à¹ˆà¸­à¸™à¹„à¸«à¸§) à¸ˆà¸°à¹€à¸‚à¹‰à¸²à¸–à¸¶à¸‡à¹„à¸”à¹‰
-- à¹à¸šà¸š public à¸–à¹‰à¸²à¸¡à¸µà¸¥à¸´à¸‡à¸à¹Œ à¸–à¹‰à¸²à¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¹ƒà¸«à¹‰à¹€à¸­à¸à¸ªà¸²à¸£à¹€à¸›à¹‡à¸™à¸„à¸§à¸²à¸¡à¸¥à¸±à¸š à¸„à¸§à¸£à¹à¸¢à¸à¹€à¸›à¹‡à¸™ bucket
-- private (public = false) à¸•à¹ˆà¸²à¸‡à¸«à¸²à¸ à¹à¸¥à¹‰à¸§à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ DocumentsManager.tsx à¹ƒà¸«à¹‰à¹ƒà¸Šà¹‰
-- createSignedUrl() à¹à¸—à¸™ getPublicUrl() €” à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸—à¸³à¹ƒà¸™à¸£à¸­à¸šà¸™à¸µà¹‰à¹€à¸žà¸£à¸²à¸°à¸•à¹‰à¸­à¸‡à¹à¸à¹‰à¹‚à¸„à¹‰à¸” component
-- à¹€à¸žà¸´à¹ˆà¸¡à¸”à¹‰à¸§à¸¢ à¸„à¸§à¸£à¸•à¸±à¸”à¸ªà¸´à¸™à¹ƒà¸ˆà¸£à¹ˆà¸§à¸¡à¸à¸±à¸šà¸—à¸µà¸¡à¸à¹ˆà¸­à¸™à¸§à¹ˆà¸²à¸ˆà¸°à¸¢à¸­à¸¡à¸£à¸±à¸šà¸„à¸§à¸²à¸¡à¹€à¸ªà¸µà¹ˆà¸¢à¸‡à¸™à¸µà¹‰à¸«à¸£à¸·à¸­à¹à¸¢à¸ bucket
