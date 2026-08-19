-- ============================================================
-- ADD MISSING RLS POLICIES (à¸£à¸±à¸™à¸«à¸¥à¸±à¸‡ schema à¸«à¸¥à¸±à¸ 75473b.sql)
-- ============================================================
-- à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸: bookings, packages, documents à¸¡à¸µ policy "FOR ALL" à¸­à¸¢à¸¹à¹ˆà¹à¸¥à¹‰à¸§
-- à¹ƒà¸™ schema à¸«à¸¥à¸±à¸ (à¸„à¸£à¸­à¸šà¸„à¸¥à¸¸à¸¡ INSERT/UPDATE/DELETE) à¸ˆà¸¶à¸‡à¸•à¸±à¸”à¸­à¸­à¸ à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡à¹€à¸žà¸´à¹ˆà¸¡à¸‹à¹‰à¸³
-- à¹€à¸«à¸¥à¸·à¸­à¹à¸„à¹ˆ 2 policy à¸—à¸µà¹ˆ "à¸‚à¸²à¸”à¸ˆà¸£à¸´à¸‡" à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™:

-- œ… organizations: UPDATE policy (CompanyProfile.tsx à¹ƒà¸Šà¹‰ update)
CREATE POLICY "Users can update their own organization" ON public.organizations
    FOR UPDATE USING (id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- œ… subscriptions: INSERT policy (BillingDashboard.tsx à¹ƒà¸Šà¹‰ insert à¸•à¸­à¸™à¸­à¸±à¸›à¹€à¸à¸£à¸”à¹à¸œà¸™)
CREATE POLICY "Users can create subscriptions for their org" ON public.subscriptions
    FOR INSERT WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- œ… subscriptions: UPDATE policy (à¹€à¸œà¸·à¹ˆà¸­à¹„à¸§à¹‰à¸ªà¸³à¸«à¸£à¸±à¸š cancel/downgrade à¹ƒà¸™à¸­à¸™à¸²à¸„à¸•)
CREATE POLICY "Users can update their organization's subscriptions" ON public.subscriptions
    FOR UPDATE USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
