-- ============================================================================
-- 072_add_branches_partner_id.sql
--
-- ปลอดภัยที่จะรัน (idempotent) — ใช้ IF NOT EXISTS ทั้งหมด
--
-- เหตุผล: public.current_user_partner_id() (migration 007) และ
-- getPartnerSession() (src/lib/partner/auth.ts) ทั้งคู่ query
-- branches.partner_id อยู่แล้วจริงในโปรดักชัน แต่ไม่มี migration ไหนใน
-- ชุดที่ track ไว้ (001-071) ที่ CREATE คอลัมน์นี้บน public.branches —
-- 001_schema_and_rls.sql สร้าง branches โดยไม่มี partner_id เลย
-- แปลว่าคอลัมน์นี้ถูกเพิ่มตรงผ่าน Supabase dashboard มาก่อนหน้านี้แล้ว
-- โดยไม่มีไฟล์ migration บันทึกไว้ ไฟล์นี้เพิ่มให้ reproducible แบบ
-- defensive — จะไม่มีผลอะไรถ้าคอลัมน์มีอยู่แล้วในโปรดักชัน แต่จะทำให้
-- schema ใหม่ (dev/staging) ตั้งต้นได้ตรงกับของจริง
-- ============================================================================

ALTER TABLE public.branches
    ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_branches_partner_id ON public.branches(partner_id);

-- ============================================================================
-- VERIFY after running:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'branches' and column_name = 'partner_id';
-- ============================================================================