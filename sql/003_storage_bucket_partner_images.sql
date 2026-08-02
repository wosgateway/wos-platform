-- ============================================================
-- 003_storage_bucket_partner_images.sql
-- ============================================================
-- สร้าง storage bucket "partner-images" + policy ที่ขาดไป (README เดิมข้อ 5)
-- รันหลัง 001_schema_and_rls.sql และ 002_missing_rls_policies.sql
--
-- Path convention ที่ component จริงใช้อยู่แล้ว (ดูใน CompanyProfile.tsx /
-- PackagesManager.tsx / DocumentsManager.tsx):
--   organizations/<organization_id>/<timestamp>_<filename>   (โลโก้/รูปปก)
--   packages/<organization_id>/<timestamp>_<filename>        (รูปโปรแกรม)
--   documents/<organization_id>/<timestamp>_<filename>       (เอกสาร/ใบอนุญาต)
-- => segment ที่ 2 (index 2 ใน storage.foldername) คือ organization_id เสมอ

-- 1. สร้าง bucket แบบ public read (ตรงกับที่ component เรียก getPublicUrl())
insert into storage.buckets (id, name, public)
values ('partner-images', 'partner-images', true)
on conflict (id) do nothing;

-- 2. ลบ policy ชื่อเดียวกันถ้ามีอยู่แล้ว กันรันซ้ำ error
drop policy if exists "partner-images public read" on storage.objects;
drop policy if exists "partner-images org-scoped insert" on storage.objects;
drop policy if exists "partner-images org-scoped update" on storage.objects;
drop policy if exists "partner-images org-scoped delete" on storage.objects;

-- 3. Public read: ใครก็ตามที่มีลิงก์เห็นรูป/ไฟล์ได้ (ตรงกับ getPublicUrl())
create policy "partner-images public read"
on storage.objects for select
to public
using (bucket_id = 'partner-images');

-- 4. Insert: ผู้ใช้ที่ login แล้วอัปโหลดได้เฉพาะโฟลเดอร์ขององค์กรตัวเองเท่านั้น
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

-- 5. Update: แก้ไข/เขียนทับไฟล์ได้เฉพาะในโฟลเดอร์องค์กรตัวเอง
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

-- 6. Delete: ลบไฟล์ได้เฉพาะในโฟลเดอร์องค์กรตัวเอง
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

-- ⚠️ หมายเหตุด้านความปลอดภัย (ไม่ได้แก้ในไฟล์นี้ เพราะเป็นการเปลี่ยน behavior เดิม):
-- DocumentsManager.tsx อัปโหลดเอกสาร/ใบอนุญาตไปที่ bucket เดียวกันนี้และเรียก
-- getPublicUrl() เหมือนกัน ซึ่งแปลว่าไฟล์เอกสาร (อาจมีข้อมูลอ่อนไหว) จะเข้าถึงได้
-- แบบ public ถ้ามีลิงก์ ถ้าต้องการให้เอกสารเป็นความลับ ควรแยกเป็น bucket
-- private (public = false) ต่างหาก แล้วเปลี่ยน DocumentsManager.tsx ให้ใช้
-- createSignedUrl() แทน getPublicUrl() — ไม่ได้ทำในรอบนี้เพราะต้องแก้โค้ด component
-- เพิ่มด้วย ควรตัดสินใจร่วมกับทีมก่อนว่าจะยอมรับความเสี่ยงนี้หรือแยก bucket
