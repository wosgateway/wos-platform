-- ============================================================
-- ADD MISSING RLS POLICIES (รันหลัง schema หลัก 75473b.sql)
-- ============================================================
-- หมายเหตุ: bookings, packages, documents มี policy "FOR ALL" อยู่แล้ว
-- ใน schema หลัก (ครอบคลุม INSERT/UPDATE/DELETE) จึงตัดออก ไม่ต้องเพิ่มซ้ำ
-- เหลือแค่ 2 policy ที่ "ขาดจริง" เท่านั้น:

-- ✅ organizations: UPDATE policy (CompanyProfile.tsx ใช้ update)
CREATE POLICY "Users can update their own organization" ON public.organizations
    FOR UPDATE USING (id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- ✅ subscriptions: INSERT policy (BillingDashboard.tsx ใช้ insert ตอนอัปเกรดแผน)
CREATE POLICY "Users can create subscriptions for their org" ON public.subscriptions
    FOR INSERT WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- ✅ subscriptions: UPDATE policy (เผื่อไว้สำหรับ cancel/downgrade ในอนาคต)
CREATE POLICY "Users can update their organization's subscriptions" ON public.subscriptions
    FOR UPDATE USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
