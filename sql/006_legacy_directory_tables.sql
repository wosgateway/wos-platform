-- ============================================================
-- 006_legacy_directory_tables.sql
-- ============================================================
-- ⚠️ RECONSTRUCTED SNAPSHOT — ไม่ใช่ไฟล์ migration ต้นฉบับจริง
-- ประกอบขึ้นย้อนหลังจาก schema จริงบน Supabase เมื่อ 2026-08-02
--
-- ตารางในไฟล์นี้ (cases, partners) ดูจากโครงสร้างแล้วเป็นของระบบเดิม
-- ก่อนเริ่มทำ partner portal (ไม่มี organization_id, ไม่ผูกกับระบบ
-- multi-tenant เหมือนตารางอื่น) — ไม่เคยถูกบันทึกไว้ในไฟล์ migration
-- ไหนมาก่อนเลย เก็บไว้เพื่อให้ repo ตรงกับ database จริงทั้งหมด
--
-- ⚠️ ค่า DEFAULT บางตัวในตาราง "cases" (status, hospital, case_no) ตอน
-- export ออกมาจาก information_schema มีลักษณะ quote ซ้อนกันแปลกๆ
-- (ผลลัพธ์จาก query อาจถูก escape ซ้ำระหว่างทาง) ไฟล์นี้ใช้ค่าที่ทำความ
-- สะอาดแล้วตามความหมายที่น่าจะเป็นจริง — ถ้าต้องพึ่งค่า default ตรงนี้
-- แบบเป๊ะๆ ควรเช็คกับ production อีกครั้งด้วย:
--   select column_name, column_default from information_schema.columns
--   where table_name = 'cases';
--
-- ปลอดภัยที่จะรันซ้ำ (idempotent) — ใช้ IF NOT EXISTS ทั้งหมด
-- ============================================================

-- ------------------------------------------------------------
-- cases — แบบฟอร์ม lead-capture สาธารณะ (ไม่ผูก organization ใดๆ,
-- เปิดให้ anon เขียน/อ่าน/แก้ไขได้ตรงๆ ผ่าน RLS — เป็นแบบฟอร์มติดต่อ
-- สาธารณะ เช่น become-partner หรือ price-inquiry)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    patient_name TEXT,
    phone_number TEXT,
    service_type TEXT,
    status TEXT DEFAULT 'new_lead',
    hospital TEXT DEFAULT 'dr_dew_khon_kaen',
    preferred_date DATE,
    case_no TEXT DEFAULT 'WOS-',
    message TEXT,
    travel_date DATE,
    line_id TEXT,
    travel_time TEXT
);

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

-- หมายเหตุ: มี INSERT policy อยู่ 2 อัน ทำงานซ้ำซ้อนกัน (คนละชื่อ
-- แต่เงื่อนไขเหมือนกัน) คงไว้ตามจริงในฐานข้อมูลปัจจุบัน ไม่ได้ลบออก
-- เพราะการลบอาจกระทบพฤติกรรมที่ทีมอื่นพึ่งพาอยู่โดยไม่รู้ตัว
DROP POLICY IF EXISTS "Allow public insert on cases" ON public.cases;
CREATE POLICY "Allow public insert on cases" ON public.cases
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Enable public insert" ON public.cases;
CREATE POLICY "Enable public insert" ON public.cases
    FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public select on cases" ON public.cases;
CREATE POLICY "Allow public select on cases" ON public.cases
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow public update on cases" ON public.cases;
CREATE POLICY "Allow public update on cases" ON public.cases
    FOR UPDATE TO anon, authenticated USING (true);

-- ------------------------------------------------------------
-- partners — สารบบพาร์ทเนอร์แบบ public directory (แสดงหน้า
-- become-partner / partner listing ฝั่งผู้เยี่ยมชมเว็บ) คนละแนวคิดกับ
-- public.organizations ที่ใช้ผูก partner portal login
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    rating NUMERIC(2, 1) DEFAULT 0,
    province TEXT,
    logo_url TEXT,
    cover_image_url TEXT,
    gallery_urls JSONB DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    review_count INTEGER DEFAULT 0,
    CONSTRAINT partners_category_check CHECK (category = ANY (ARRAY['Hospital','Clinic','Dental','Wellness','Spa','Hotel','Transport'])),
    CONSTRAINT partners_status_check CHECK (status = ANY (ARRAY['active','inactive']))
);

CREATE INDEX IF NOT EXISTS idx_partners_status ON public.partners(status);
CREATE INDEX IF NOT EXISTS idx_partners_category ON public.partners(category);

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

-- หมายเหตุ: เช่นเดียวกับ cases มี policy ซ้ำซ้อนกันหลายอัน (ALL x2,
-- SELECT x2) คงไว้ตามจริงในฐานข้อมูลปัจจุบันทั้งหมด
DROP POLICY IF EXISTS "Authenticated can manage partners" ON public.partners;
CREATE POLICY "Authenticated can manage partners" ON public.partners
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated write partners" ON public.partners;
CREATE POLICY "Authenticated write partners" ON public.partners
    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow public delete on partners" ON public.partners;
CREATE POLICY "Allow public delete on partners" ON public.partners
    FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Enable insert for anon" ON public.partners;
CREATE POLICY "Enable insert for anon" ON public.partners
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Public can view partners" ON public.partners;
CREATE POLICY "Public can view partners" ON public.partners
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read active partners" ON public.partners;
CREATE POLICY "public read active partners" ON public.partners
    FOR SELECT USING (status = 'active');
