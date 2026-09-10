-- ============================================================================
-- 091_consultation_requests.sql  (REVISED — ตาม Spec Review 7+3 ข้อ)
--
-- Feature: "ปรึกษา WOS ฟรี" — Free Consultation Lead Engine (V1)
-- Phase 0: Database & Schema
--
-- ที่มา: WOS Task Spec — "ปรึกษา WOS ฟรี" (public consultation form
-- ที่ /[locale]/consultation + CTA บน Homepage)
-- แก้ตามผลตรวจสอบ spec (7 จุดหลัก + 3 จุดเสริม) ดังนี้:
--
--   [แก้ใน SQL นี้]
--   #2 source                -> เพิ่ม CHECK allowlist (กัน analytics เพี้ยน)
--   #3 contact                -> แยกเป็น contact_channel + contact_value
--   #4 request_types          -> ปรับ canonical values ให้ตรงตามที่ตกลงท้าย doc
--                                 (checkup -> health_checkup, accommodation -> hotel)
--   #5 status transitions     -> เพิ่ม trigger บังคับ allowed transitions
--                                 (ไม่ปล่อยให้ UPDATE status ข้ามขั้นได้ตามใจ)
--   #6 "converted" definition -> ใส่เป็น COMMENT ON COLUMN เก็บนิยามไว้ใน DB
--   B. utm_*                  -> เพิ่ม utm_source/medium/campaign/content
--   [เพิ่มเติมนอกเหนือจาก review — ปิดช่องโหว่จริงของ Acceptance Criteria]
--   - เดิม INSERT policy เป็น WITH CHECK(true) ซึ่ง "ไม่ได้" กัน client
--     ส่ง status / created_at / internal_notes มาเองใน payload จริง ๆ
--     (DEFAULT ใช้เฉพาะตอนไม่ส่งค่า) -> เพิ่ม BEFORE INSERT trigger บังคับ
--     ค่าฝั่ง server เสมอ ไม่พึ่ง DEFAULT อย่างเดียว
--
--   [ไม่แก้ในไฟล์นี้ เพราะไม่ใช่ขอบเขต Phase 0 / DB]
--   #1 lo/la routing          -> เป็นเรื่อง Next.js route, ใน SQL นี้ใช้ 'lo'
--                                 อยู่แล้วซึ่งถูกต้องตามที่ควรเลือก ไม่ต้องแก้
--   #7 notification recipient -> Phase 5 (API/notification), ไม่เกี่ยวกับ schema
--   A. locale                 -> มี column `language` ทำหน้าที่เดียวกันอยู่แล้ว
--   C. updated_at             -> มีอยู่แล้วพร้อม trigger เดิม ไม่ต้องแก้
--
-- แพทเทิร์นอ้างอิงจาก 030_partner_applications.sql:
--   - INSERT: เปิดให้ anon + authenticated (ฟอร์มสาธารณะ ไม่ login)
--   - SELECT/UPDATE/DELETE: เฉพาะ is_platform_admin() เท่านั้น
--   - updated_at ใช้ trigger เดิม public.handle_updated_at()
--   - ไฟล์นี้ปลอดภัยที่จะรันซ้ำ (idempotent) — ใช้ IF NOT EXISTS / OR REPLACE
--     ไม่แตะตาราง/policy ใดที่มีอยู่แล้วนอกเหนือจากของฟีเจอร์นี้
--   - หมายเหตุ: CREATE TABLE IF NOT EXISTS จะ "ข้าม" ถ้าตารางนี้ถูกสร้างไปแล้ว
--     ด้วยเวอร์ชันเดิม (ที่ยังไม่แก้) — ถ้า deploy ไปแล้วต้องเขียน migration
--     ใหม่เป็น ALTER TABLE แทน ไฟล์นี้ตั้งสมมติฐานว่ายังไม่เคยรันจริง
--
-- Security (ตาม spec ข้อ 12 + acceptance criteria):
--   - client กำหนด status เองไม่ได้    -> RLS WITH CHECK + BEFORE INSERT trigger
--   - client กำหนด created_at เองไม่ได้ -> BEFORE INSERT trigger บังคับ now()
--   - client กำหนด internal_notes/contacted_by/contacted_at เองไม่ได้
--                                        -> BEFORE INSERT trigger เคลียร์เป็น NULL
--   - ไม่เก็บข้อมูลทางการแพทย์ละเอียด — เก็บแค่ request_types (ตัวเลือกกว้างๆ)
--     และ message (free text ที่ลูกค้าเขียนเอง) เท่านั้น
--   - ip_address/user_agent: สมมติฐานคือ Phase 2 API (server-side) เป็นคนเซ็ต
--     ค่านี้จาก request จริง ไม่ใช่รับตรงจาก client JSON body — ต้อง enforce
--     ที่ชั้น API ด้วย (SQL layer เดียวแยกลูกค้าจริงจาก client ปลอมไม่ได้)
-- ============================================================================

-- --------------------------------------------------------------------------
-- ตาราง consultation_requests
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consultation_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    language            TEXT NOT NULL DEFAULT 'th'
                        CHECK (language IN ('th', 'en', 'lo')),

    name                TEXT NOT NULL
                        CHECK (char_length(name) BETWEEN 1 AND 100),

    -- #3: แยก contact ออกเป็น channel + value เพื่อให้ต่อ CRM/notification ง่ายขึ้น
    contact_channel     TEXT NOT NULL
                        CHECK (contact_channel IN ('phone', 'whatsapp', 'line', 'email', 'other')),
    contact_value       TEXT NOT NULL
                        CHECK (char_length(contact_value) BETWEEN 3 AND 100),

    country             TEXT NOT NULL,

    -- #4: canonical values ปรับให้ตรงกับ schema สรุปท้าย review
    request_types       TEXT[] NOT NULL DEFAULT '{}'
                        CHECK (request_types <@ ARRAY[
                            'health_checkup', 'medical_treatment', 'dental',
                            'wellness', 'aesthetic', 'hospital_clinic',
                            'hotel', 'transport', 'not_sure'
                        ]::TEXT[]),

    message              TEXT
                         CHECK (message IS NULL OR char_length(message) <= 2000),

    travel_period         TEXT NOT NULL DEFAULT 'unspecified'
                          CHECK (travel_period IN (
                              'unspecified', 'within_1_month',
                              '1_to_3_months', 'more_than_3_months'
                          )),

    status                TEXT NOT NULL DEFAULT 'new'
                          CHECK (status IN (
                              'new', 'contacted', 'qualified',
                              'converted', 'closed'
                          )),

    -- #2: source ต้องอยู่ใน allowlist เท่านั้น กัน analytics เพี้ยนจาก client ยิงเอง
    source                TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (source IN (
                              'homepage_hero', 'homepage_bottom', 'partner_page',
                              'package_page', 'knowledge_center', 'unknown'
                          )),

    -- B: utm_* เผื่อยิง ads ในอนาคต ไม่ต้องแสดงใน form แต่เก็บไว้ใน DB ได้เลย
    utm_source            TEXT,
    utm_medium            TEXT,
    utm_campaign          TEXT,
    utm_content            TEXT,

    internal_notes         TEXT,
    contacted_by            TEXT,
    contacted_at             TIMESTAMPTZ,

    ip_address                TEXT,
    user_agent                 TEXT,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.consultation_requests.status IS
    '#6: "converted" = Lead นี้กลายเป็น WOS Journey/Order ที่เริ่มกระบวนการจริงแล้ว '
    'ไม่ใช่แค่ "ลูกค้าตอบกลับ" (นั่นคือ contacted/qualified) '
    'Funnel: Visitor -> Consultation -> Contacted -> Qualified -> Converted -> Journey -> Completed';

CREATE INDEX IF NOT EXISTS idx_consultation_requests_status
    ON public.consultation_requests(status);

CREATE INDEX IF NOT EXISTS idx_consultation_requests_source
    ON public.consultation_requests(source);

CREATE INDEX IF NOT EXISTS idx_consultation_requests_created_at
    ON public.consultation_requests(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_consultation_requests_utm_campaign
    ON public.consultation_requests(utm_campaign) WHERE utm_campaign IS NOT NULL;

-- --------------------------------------------------------------------------
-- Trigger — reuse public.handle_updated_at()
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_consultation_requests
    ON public.consultation_requests;

CREATE TRIGGER set_updated_at_consultation_requests
    BEFORE UPDATE ON public.consultation_requests
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------------------------------------
-- #5: บังคับ allowed status transitions ที่ระดับ DB (defense-in-depth
-- เผื่อ Admin UI มี bug หรือมีคนยิง UPDATE ตรงผ่าน SQL/console)
--
--   new -> contacted | closed
--   contacted -> qualified | closed
--   qualified -> converted | closed
--   converted -> closed
--   closed -> (terminal, ห้ามเปลี่ยนต่อ)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_consultation_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT (
        (OLD.status = 'new'       AND NEW.status IN ('contacted', 'closed')) OR
        (OLD.status = 'contacted' AND NEW.status IN ('qualified', 'closed')) OR
        (OLD.status = 'qualified' AND NEW.status IN ('converted', 'closed')) OR
        (OLD.status = 'converted' AND NEW.status = 'closed')
    ) THEN
        RAISE EXCEPTION 'Invalid consultation status transition: % -> %', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_consultation_status_transition
    ON public.consultation_requests;

CREATE TRIGGER enforce_consultation_status_transition
    BEFORE UPDATE ON public.consultation_requests
    FOR EACH ROW
    WHEN (NEW.status IS DISTINCT FROM OLD.status)
    EXECUTE FUNCTION public.check_consultation_status_transition();

-- --------------------------------------------------------------------------
-- [เพิ่มเติม] บังคับค่าฝั่ง server ตอน INSERT — ปิดช่องที่ RLS WITH CHECK
-- อย่างเดียวปิดไม่สนิท (client ส่ง status/created_at/internal_notes มาใน
-- payload เองได้ ถ้าไม่มี trigger นี้ dependent เฉพาะ DEFAULT ไม่พอ)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_consultation_request_server_fields()
RETURNS TRIGGER AS $$
BEGIN
    NEW.status         := 'new';
    NEW.created_at      := now();
    NEW.updated_at       := now();
    NEW.internal_notes    := NULL;
    NEW.contacted_by       := NULL;
    NEW.contacted_at        := NULL;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lock_consultation_request_server_fields_trigger
    ON public.consultation_requests;

CREATE TRIGGER lock_consultation_request_server_fields_trigger
    BEFORE INSERT ON public.consultation_requests
    FOR EACH ROW EXECUTE FUNCTION public.lock_consultation_request_server_fields();

-- --------------------------------------------------------------------------
-- Row Level Security
--
--   - INSERT: anon + authenticated (ฟอร์มสาธารณะ /[locale]/consultation
--     ไม่ต้อง login) — WITH CHECK บังคับ status='new' ซ้ำอีกชั้น (แม้ trigger
--     ด้านบนจะบังคับอยู่แล้วก็ตาม เผื่อกรณี trigger ถูกปิด/แก้ในอนาคต)
--   - SELECT/UPDATE/DELETE: เฉพาะ is_platform_admin() (WOS staff เท่านั้น
--     ตาม /admin/consultations) — ไม่ใช่ "authenticated" เฉยๆ ซึ่งจะรวม
--     partner-portal ด้วย (ดูหมายเหตุเดียวกันใน 030_partner_applications.sql)
-- --------------------------------------------------------------------------
ALTER TABLE public.consultation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public insert on consultation_requests" ON public.consultation_requests;
CREATE POLICY "Allow public insert on consultation_requests" ON public.consultation_requests
    FOR INSERT TO anon, authenticated
    WITH CHECK (status = 'new');

DROP POLICY IF EXISTS "Platform admins can manage consultation_requests" ON public.consultation_requests;
CREATE POLICY "Platform admins can manage consultation_requests" ON public.consultation_requests
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

-- ============================================================================
-- VERIFY after running:
--   select policyname, roles, cmd, qual, with_check from pg_policies
--   where tablename = 'consultation_requests';
-- ควรได้ 2 แถว: INSERT (anon,authenticated, with_check: status='new')
--               / ALL (authenticated, qual+with_check: is_platform_admin())
--
--   select column_name, data_type from information_schema.columns
--   where table_name = 'consultation_requests' order by ordinal_position;
--
--   -- ทดสอบว่า client แก้ status/created_at เองไม่ได้ (ควร error หรือถูกเขียนทับ):
--   insert into public.consultation_requests
--     (name, contact_channel, contact_value, country, status, created_at)
--   values
--     ('test', 'phone', '0800000000', 'TH', 'converted', '2000-01-01')
--   returning status, created_at;  -- คาดหวัง status='new', created_at=now()
--
--   -- ทดสอบ status transition ข้ามขั้น (ควร error):
--   -- update ... set status = 'converted' where status = 'new';
-- ============================================================================
