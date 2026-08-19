-- ============================================================================
-- 031_fix_cases_rls.sql
--
-- public.cases (à¸•à¸±à¹‰à¸‡à¹„à¸§à¹‰à¸•à¸±à¹‰à¸‡à¹à¸•à¹ˆ 008_restrict_cases_rls.sql) à¹ƒà¸Šà¹‰
-- `to authenticated using (true)` à¸ªà¸³à¸«à¸£à¸±à¸š SELECT/UPDATE €” à¸„à¸£à¸­à¸šà¸„à¸¥à¸¸à¸¡à¸—à¸¸à¸à¸„à¸™à¸—à¸µà¹ˆ
-- login à¸œà¹ˆà¸²à¸™ Supabase Auth pool à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸™ à¸£à¸§à¸¡à¸–à¸¶à¸‡ staff à¸‚à¸­à¸‡à¸žà¸²à¸£à¹Œà¸—à¹€à¸™à¸­à¸£à¹Œà¹€à¸­à¸‡
-- (login à¸œà¹ˆà¸²à¸™ (partner-portal), à¸”à¸¹ src/lib/partner/auth.ts) à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¹à¸„à¹ˆ WOS
-- staff €” à¹à¸à¹‰à¹ƒà¸«à¹‰à¹ƒà¸Šà¹‰ is_platform_admin() à¹à¸šà¸šà¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸š 030_partner_applications.sql
-- (à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¹à¸à¹‰à¹à¸¥à¹‰à¸§) à¹à¸¥à¸° public.packages/public.partners
--
-- à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸: partner_applications à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡à¹à¸à¹‰à¹ƒà¸™à¹„à¸Ÿà¸¥à¹Œà¸™à¸µà¹‰à¸­à¸µà¸ à¹€à¸žà¸£à¸²à¸°
-- 030_partner_applications.sql à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¹à¸à¹‰à¹à¸¥à¹‰à¸§à¹ƒà¸Šà¹‰ is_platform_admin()
-- à¸•à¸±à¹‰à¸‡à¹à¸•à¹ˆà¸ªà¸£à¹‰à¸²à¸‡à¸•à¸²à¸£à¸²à¸‡à¹€à¸¥à¸¢
--
-- à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢à¸—à¸µà¹ˆà¸ˆà¸°à¸£à¸±à¸™à¸‹à¹‰à¸³ (idempotent)
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated can select cases" ON public.cases;
DROP POLICY IF EXISTS "Authenticated can update cases" ON public.cases;
DROP POLICY IF EXISTS "Platform admins can manage cases" ON public.cases;

CREATE POLICY "Platform admins can manage cases" ON public.cases
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

-- "Allow public insert on cases" (anon,authenticated / WITH CHECK true) à¸„à¸‡à¹„à¸§à¹‰à¹€à¸«à¸¡à¸·à¸­à¸™à¹€à¸”à¸´à¸¡ €” à¹„à¸¡à¹ˆà¹à¸•à¸°

-- ============================================================================
-- VERIFY after running:
--   select policyname, roles, cmd, qual from pg_policies where tablename = 'cases';
-- à¸„à¸§à¸£à¹„à¸”à¹‰ 2 à¹à¸–à¸§: INSERT (anon,authenticated) / ALL (authenticated, qual: is_platform_admin())
--
-- à¸—à¸”à¸ªà¸­à¸šà¸”à¹‰à¸§à¸¢à¸šà¸±à¸à¸Šà¸µ org-admin à¸‚à¸­à¸‡à¸žà¸²à¸£à¹Œà¸—à¹€à¸™à¸­à¸£à¹Œ (role='admin', is_platform_admin=false
-- à¹€à¸Šà¹ˆà¸™ royalbridge99@gmail.com) à¸§à¹ˆà¸² select à¸ˆà¸²à¸ cases à¹„à¸”à¹‰ 0 à¹à¸–à¸§ (à¹„à¸¡à¹ˆ error)
-- à¹à¸¥à¸°à¸—à¸”à¸ªà¸­à¸šà¸”à¹‰à¸§à¸¢à¸šà¸±à¸à¸Šà¸µ WOS platform admin à¸ˆà¸£à¸´à¸‡ (à¹€à¸Šà¹ˆà¸™ pimotif@gmail.com) à¸§à¹ˆà¸²à¸¢à¸±à¸‡
-- à¹€à¸«à¹‡à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸„à¸£à¸šà¹€à¸«à¸¡à¸·à¸­à¸™à¹€à¸”à¸´à¸¡
-- ============================================================================
