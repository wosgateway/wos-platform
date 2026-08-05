-- ============================================================
-- 007_consolidate_group_b_rls_and_fk_fixes.sql
--
-- รวบรวม SQL ที่รันสดในเซสชัน "deploy-readiness pass" (ดู PROJECT_STRUCTURE.md ข้อ 5-6)
-- เก็บไว้เป็นไฟล์เพื่อ reproduce ได้ถ้าต้อง setup database ใหม่
-- (staging environment / disaster recovery)
--
-- ⚠️ ก่อนรันบน production จริง แนะนำให้รัน preflight query ด้านล่างก่อน
-- เพื่อเช็คชื่อ policy จริงในระบบ เพราะ DROP POLICY IF EXISTS ในไฟล์นี้อ้างชื่อ
-- ตามที่ระบุไว้ใน RLS_Policy_.sql กับ SQL_DDL_สำหรับ_Partner_Portal (8 Tables).sql —
-- ถ้าใน production มีชื่อ policy อื่นที่ไม่ตรง (เช่น policy ซ้ำซ้อนของ partner_packages
-- ที่เกิดจากตอน rename ตาราง sql/004) ให้เพิ่ม DROP POLICY IF EXISTS บรรทัดใหม่เอง
-- ตามชื่อที่เจอจริงก่อนรัน CREATE POLICY ด้านล่าง
--
--   -- Preflight: หา policy ทั้งหมดที่ใช้กลไกเดิม (user_metadata) ที่ใช้งานไม่ได้จริง
--   select schemaname, tablename, policyname, cmd
--   from pg_policies
--   where qual::text like '%user_metadata%' or with_check::text like '%user_metadata%'
--   order by tablename, policyname;
--
--   -- Preflight: หา policy ซ้ำซ้อนของ partner_packages (คาดว่ามี 4 ตัวจากตอน rename)
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where tablename = 'partner_packages';
-- ============================================================

-- ============================================================
-- 1. HELPER FUNCTIONS (SECURITY DEFINER)
--    ใช้แทนการเขียน subquery ซ้ำทุก policy ของกลุ่ม B
--    SECURITY DEFINER เพื่อ bypass RLS ตอน query ภายในฟังก์ชันเอง
--    (กัน infinite recursion ตอนเช็ค policy ของตาราง users ที่ query ตัวเอง)
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_user_organization_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id
  FROM public.users
  WHERE supabase_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_partner_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT b.partner_id
  FROM public.users u
  JOIN public.branches b ON b.id = u.branch_id
  WHERE u.supabase_user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_organization_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_partner_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_partner_id() TO authenticated;

-- ============================================================
-- 2. แก้ policy ของ packages (กลุ่ม A — ตัวจริงที่ใช้ partner_id)
--    บั๊ก: correlated subquery เดิมอ้างอิง packages.partner_id ของแถวตัวเอง
--    ไม่ใช่คอลัมน์ของ users → กลายเป็น tautology ที่ผ่านเสมอไม่ว่า user เป็นใคร
--    (ช่องโหว่ความปลอดภัยข้ามบัญชี — ดู PROJECT_STRUCTURE.md ข้อ 5.1)
-- ============================================================

DROP POLICY IF EXISTS "Partners can manage their own packages" ON public.packages;

CREATE POLICY "Partners can manage their own packages" ON public.packages
    FOR ALL
    USING (
        partner_id IN (
            SELECT b.partner_id
            FROM public.users u
            JOIN public.branches b ON b.id = u.branch_id
            WHERE u.supabase_user_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        partner_id IN (
            SELECT b.partner_id
            FROM public.users u
            JOIN public.branches b ON b.id = u.branch_id
            WHERE u.supabase_user_id = (SELECT auth.uid())
        )
    );

-- ============================================================
-- 3. เคลียร์ policy ซ้ำซ้อนของ partner_packages
--    (เกิดจากตอน rename ตาราง sql/004 — มี policy ทำหน้าที่เดิมซ้ำกัน ~4 ตัว)
--    ชื่อด้านล่างคือชื่อที่คาดว่ามาจาก RLS_Policy_.sql / SQL_DDL เดิม
--    ถ้า preflight query เจอชื่ออื่น ให้เพิ่ม DROP POLICY IF EXISTS เองก่อนรัน CREATE
-- ============================================================

DROP POLICY IF EXISTS "Users can view their organization's packages" ON public.partner_packages;
DROP POLICY IF EXISTS "Users can manage their organization's packages" ON public.partner_packages;

CREATE POLICY "Users can view their organization's packages" ON public.partner_packages
    FOR SELECT USING (organization_id = public.current_user_organization_id());

CREATE POLICY "Users can manage their organization's packages" ON public.partner_packages
    FOR ALL USING (organization_id = public.current_user_organization_id());

-- ============================================================
-- 4. organizations / branches / users
--    เดิมใช้ auth.jwt() -> 'user_metadata' ->> 'organization_id' ซึ่งไม่เคยถูก set
--    ให้ user จริงเลย → บล็อกทุกคนแบบเงียบๆ มาตลอด
-- ============================================================

DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
CREATE POLICY "Users can view their own organization" ON public.organizations
    FOR SELECT USING (id = public.current_user_organization_id());

DROP POLICY IF EXISTS "Users can view their organization's branches" ON public.branches;
CREATE POLICY "Users can view their organization's branches" ON public.branches
    FOR SELECT USING (organization_id = public.current_user_organization_id());

DROP POLICY IF EXISTS "Users can view their organization's users" ON public.users;
CREATE POLICY "Users can view their organization's users" ON public.users
    FOR SELECT USING (organization_id = public.current_user_organization_id());

-- ============================================================
-- 5. patients
-- ============================================================

DROP POLICY IF EXISTS "Users can view their organization's patients" ON public.patients;
CREATE POLICY "Users can view their organization's patients" ON public.patients
    FOR SELECT USING (organization_id = public.current_user_organization_id());

-- ============================================================
-- 6. partner_bookings (เดิมชื่อ policy อ้างตาราง "bookings" ตอนยังไม่ rename)
-- ============================================================

DROP POLICY IF EXISTS "Users can view their organization's bookings" ON public.partner_bookings;
DROP POLICY IF EXISTS "Users can manage their organization's bookings" ON public.partner_bookings;

CREATE POLICY "Users can view their organization's bookings" ON public.partner_bookings
    FOR SELECT USING (organization_id = public.current_user_organization_id());

CREATE POLICY "Users can manage their organization's bookings" ON public.partner_bookings
    FOR ALL USING (organization_id = public.current_user_organization_id());

-- ============================================================
-- 7. documents
-- ============================================================

DROP POLICY IF EXISTS "Users can view their organization's documents" ON public.documents;
DROP POLICY IF EXISTS "Users can manage their organization's documents" ON public.documents;

CREATE POLICY "Users can view their organization's documents" ON public.documents
    FOR SELECT USING (organization_id = public.current_user_organization_id());

CREATE POLICY "Users can manage their organization's documents" ON public.documents
    FOR ALL USING (organization_id = public.current_user_organization_id());

-- ============================================================
-- 8. subscriptions
--    เดิม insert/update ใช้ JWT user_metadata ที่ไม่เคยถูกเซ็ต → บล็อกทุกคน
-- ============================================================

DROP POLICY IF EXISTS "Users can view their organization's subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view their organization's subscriptions" ON public.subscriptions
    FOR SELECT USING (organization_id = public.current_user_organization_id());

CREATE POLICY "Users can manage their organization's subscriptions" ON public.subscriptions
    FOR ALL USING (organization_id = public.current_user_organization_id());

-- ============================================================
-- 9. notifications
--    SELECT/UPDATE ผ่าน helper function, INSERT ยังผ่าน service role เท่านั้น (ตั้งใจ)
-- ============================================================

DROP POLICY IF EXISTS "Users can view their organization's notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their organization's notifications" ON public.notifications;

CREATE POLICY "Users can view their organization's notifications" ON public.notifications
    FOR SELECT USING (organization_id = public.current_user_organization_id());

CREATE POLICY "Users can update their organization's notifications" ON public.notifications
    FOR UPDATE USING (organization_id = public.current_user_organization_id());

-- ============================================================
-- 10. แก้ FK ของ partner_bookings ให้ชี้ไป packages(id) แทน partner_packages(id)
--     (ชื่อ constraint เดิมไม่เปลี่ยน แค่เปลี่ยน target table — ดู PROJECT_STRUCTURE.md ข้อ 5.5)
--     เช็คก่อนรันจริง: ตอนแก้ครั้งแรก total_bookings = 0 จึงปลอดภัยที่จะแก้ตรงๆ
--     ถ้ามีข้อมูลจริงแล้ว ให้ตรวจสอบว่า package_id ทุกแถวมีอยู่จริงใน packages ก่อน ALTER
-- ============================================================

ALTER TABLE public.partner_bookings
    DROP CONSTRAINT IF EXISTS bookings_package_id_fkey;
ALTER TABLE public.partner_bookings
    ADD CONSTRAINT bookings_package_id_fkey
    FOREIGN KEY (package_id) REFERENCES public.packages(id) ON DELETE RESTRICT;

ALTER TABLE public.partner_bookings
    DROP CONSTRAINT IF EXISTS bookings_hotel_package_id_fkey;
ALTER TABLE public.partner_bookings
    ADD CONSTRAINT bookings_hotel_package_id_fkey
    FOREIGN KEY (hotel_package_id) REFERENCES public.packages(id) ON DELETE SET NULL;

ALTER TABLE public.partner_bookings
    DROP CONSTRAINT IF EXISTS bookings_transport_package_id_fkey;
ALTER TABLE public.partner_bookings
    ADD CONSTRAINT bookings_transport_package_id_fkey
    FOREIGN KEY (transport_package_id) REFERENCES public.packages(id) ON DELETE SET NULL;

-- ============================================================
-- 11. Postflight sanity check — รันหลังใช้ migration นี้เพื่อยืนยันว่าไม่มี policy
--     ที่ยังพึ่ง user_metadata หลงเหลืออยู่
-- ============================================================

--   select tablename, policyname
--   from pg_policies
--   where qual::text like '%user_metadata%' or with_check::text like '%user_metadata%';
--   -- ควรได้ 0 แถว
