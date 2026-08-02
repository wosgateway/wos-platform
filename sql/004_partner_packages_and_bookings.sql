-- ============================================================
-- 004_partner_packages_and_bookings.sql
-- ============================================================
-- ⚠️ RECONSTRUCTED SNAPSHOT — ไม่ใช่ไฟล์ migration ต้นฉบับจริง
--
-- ไฟล์นี้ถูกประกอบขึ้นย้อนหลังจากการ query schema จริงบน Supabase
-- (information_schema + pg_catalog) เมื่อ 2026-08-02 เนื่องจาก migration
-- ต้นฉบับที่เคยรันตรงใน SQL Editor ไม่เคยถูกบันทึกเป็นไฟล์ในโปรเจกต์
-- มาก่อน (ดูบริบทใน CLAUDE_MEMORY: เดิมเรียกกันว่า
-- "004_fix_packages_collision.sql" ตอนแก้ปัญหา 001_schema_and_rls.sql
-- ไป DROP ตาราง packages เดิมทับกับของระบบคลินิก)
--
-- สิ่งที่เกิดขึ้นจริงตามที่ schema ปัจจุบันสะท้อนไว้:
-- - ตาราง "packages" (คลินิก, service เดิม) ถูกคง/สร้างใหม่แยกไว้
-- - Partner portal ใช้ตารางชื่อ "partner_packages" และ "partner_bookings"
--   แทน เพื่อไม่ให้ชนกับของเดิม (ชื่อ constraint บางตัวยังเป็น
--   "packages_*"/"bookings_*" เพราะ RENAME TABLE ไม่เปลี่ยนชื่อ constraint
--   เดิมให้อัตโนมัติ — คงไว้ตามจริง ไม่แก้ไข)
--
-- ปลอดภัยที่จะรันซ้ำ (idempotent) เพราะใช้ IF NOT EXISTS / OR REPLACE
-- ทั้งหมด — รันกับ database ที่มีอยู่แล้วจะไม่ error และไม่ทำลายข้อมูล
-- ============================================================

-- ------------------------------------------------------------
-- Helper function ใช้ใน RLS ของสองตารางนี้ (คนละแบบกับ 001 ที่เช็ค
-- auth.jwt() ตรงๆ — ตัวนี้ query จาก public.users แทน)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_organization_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select organization_id from public.users where supabase_user_id = auth.uid()
$function$;

-- ------------------------------------------------------------
-- partner_packages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    short_description TEXT,
    category TEXT,
    sub_category TEXT,
    image_url TEXT,
    gallery_urls JSONB DEFAULT '[]'::jsonb,
    original_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    special_price NUMERIC(12, 2),
    is_promotion BOOLEAN DEFAULT false,
    duration TEXT,
    duration_minutes INTEGER,
    status TEXT DEFAULT 'draft',
    is_featured BOOLEAN DEFAULT false,
    meta_title TEXT,
    meta_description TEXT,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packages_org_id ON public.partner_packages(organization_id);
CREATE INDEX IF NOT EXISTS idx_packages_status ON public.partner_packages(status);

DROP TRIGGER IF EXISTS set_updated_at_packages ON public.partner_packages;
CREATE TRIGGER set_updated_at_packages BEFORE UPDATE ON public.partner_packages
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.partner_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their organization's partner_packages" ON public.partner_packages;
CREATE POLICY "Users can view their organization's partner_packages" ON public.partner_packages
    FOR SELECT TO authenticated
    USING (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS "Users can manage their organization's partner_packages" ON public.partner_packages;
CREATE POLICY "Users can manage their organization's partner_packages" ON public.partner_packages
    FOR ALL TO authenticated
    USING (organization_id = current_user_organization_id())
    WITH CHECK (organization_id = current_user_organization_id());

-- ------------------------------------------------------------
-- partner_bookings
-- หมายเหตุ: package_id / transport_package_id / hotel_package_id
-- ยังอ้างอิงไปที่ public.packages (ตารางคลินิกเดิม) ไม่ใช่
-- partner_packages — นี่คือสภาพจริงของ FK ในฐานข้อมูลปัจจุบัน
-- (คงไว้ตามจริง ไม่ได้แก้ให้ตรงกับที่ "ควรจะเป็น" เพราะการเปลี่ยน FK
-- target ตอนนี้อาจกระทบ query/RLS อื่นที่ผูกอยู่ — ควรตัดสินใจร่วมกับ
-- ทีมก่อนแก้ ไม่ได้ทำในไฟล์นี้)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
    booking_date DATE NOT NULL,
    booking_time TIME,
    need_transport BOOLEAN DEFAULT false,
    transport_package_id UUID REFERENCES public.packages(id),
    transport_mode TEXT,
    transport_pickup_date DATE,
    transport_pickup_time TIME,
    transport_return_date DATE,
    transport_return_time TIME,
    transport_days INTEGER,
    need_hotel BOOLEAN DEFAULT false,
    hotel_package_id UUID REFERENCES public.packages(id),
    hotel_checkin_date DATE,
    hotel_nights INTEGER,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_line TEXT,
    customer_country TEXT,
    attachment_url TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    total_price NUMERIC(12, 2),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_bookings_package_id ON public.partner_bookings(package_id);
CREATE INDEX IF NOT EXISTS idx_partner_bookings_status ON public.partner_bookings(status);
CREATE INDEX IF NOT EXISTS idx_partner_bookings_org_id ON public.partner_bookings(organization_id);
CREATE INDEX IF NOT EXISTS idx_partner_bookings_patient_id ON public.partner_bookings(patient_id);

DROP TRIGGER IF EXISTS set_updated_at_partner_bookings ON public.partner_bookings;
CREATE TRIGGER set_updated_at_partner_bookings BEFORE UPDATE ON public.partner_bookings
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.partner_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their organization's partner_bookings" ON public.partner_bookings;
CREATE POLICY "Users can view their organization's partner_bookings" ON public.partner_bookings
    FOR SELECT TO authenticated
    USING (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS "Users can manage their organization's partner_bookings" ON public.partner_bookings;
CREATE POLICY "Users can manage their organization's partner_bookings" ON public.partner_bookings
    FOR ALL TO authenticated
    USING (organization_id = current_user_organization_id())
    WITH CHECK (organization_id = current_user_organization_id());
