-- ============================================================
-- 007_consolidate_group_b_rls_and_fk_fixes.sql
--
-- à¸£à¸§à¸šà¸£à¸§à¸¡ SQL à¸—à¸µà¹ˆà¸£à¸±à¸™à¸ªà¸”à¹ƒà¸™à¹€à¸‹à¸ªà¸Šà¸±à¸™ "deploy-readiness pass" (à¸”à¸¹ PROJECT_STRUCTURE.md à¸‚à¹‰à¸­ 5-6)
-- à¹€à¸à¹‡à¸šà¹„à¸§à¹‰à¹€à¸›à¹‡à¸™à¹„à¸Ÿà¸¥à¹Œà¹€à¸žà¸·à¹ˆà¸­ reproduce à¹„à¸”à¹‰à¸–à¹‰à¸²à¸•à¹‰à¸­à¸‡ setup database à¹ƒà¸«à¸¡à¹ˆ
-- (staging environment / disaster recovery)
--
-- š ï¸ à¸à¹ˆà¸­à¸™à¸£à¸±à¸™à¸šà¸™ production à¸ˆà¸£à¸´à¸‡ à¹à¸™à¸°à¸™à¸³à¹ƒà¸«à¹‰à¸£à¸±à¸™ preflight query à¸”à¹‰à¸²à¸™à¸¥à¹ˆà¸²à¸‡à¸à¹ˆà¸­à¸™
-- à¹€à¸žà¸·à¹ˆà¸­à¹€à¸Šà¹‡à¸„à¸Šà¸·à¹ˆà¸­ policy à¸ˆà¸£à¸´à¸‡à¹ƒà¸™à¸£à¸°à¸šà¸š à¹€à¸žà¸£à¸²à¸° DROP POLICY IF EXISTS à¹ƒà¸™à¹„à¸Ÿà¸¥à¹Œà¸™à¸µà¹‰à¸­à¹‰à¸²à¸‡à¸Šà¸·à¹ˆà¸­
-- à¸•à¸²à¸¡à¸—à¸µà¹ˆà¸£à¸°à¸šà¸¸à¹„à¸§à¹‰à¹ƒà¸™ RLS_Policy_.sql à¸à¸±à¸š SQL_DDL_à¸ªà¸³à¸«à¸£à¸±à¸š_Partner_Portal (8 Tables).sql €”
-- à¸–à¹‰à¸²à¹ƒà¸™ production à¸¡à¸µà¸Šà¸·à¹ˆà¸­ policy à¸­à¸·à¹ˆà¸™à¸—à¸µà¹ˆà¹„à¸¡à¹ˆà¸•à¸£à¸‡ (à¹€à¸Šà¹ˆà¸™ policy à¸‹à¹‰à¸³à¸‹à¹‰à¸­à¸™à¸‚à¸­à¸‡ partner_packages
-- à¸—à¸µà¹ˆà¹€à¸à¸´à¸”à¸ˆà¸²à¸à¸•à¸­à¸™ rename à¸•à¸²à¸£à¸²à¸‡ sql/004) à¹ƒà¸«à¹‰à¹€à¸žà¸´à¹ˆà¸¡ DROP POLICY IF EXISTS à¸šà¸£à¸£à¸—à¸±à¸”à¹ƒà¸«à¸¡à¹ˆà¹€à¸­à¸‡
-- à¸•à¸²à¸¡à¸Šà¸·à¹ˆà¸­à¸—à¸µà¹ˆà¹€à¸ˆà¸­à¸ˆà¸£à¸´à¸‡à¸à¹ˆà¸­à¸™à¸£à¸±à¸™ CREATE POLICY à¸”à¹‰à¸²à¸™à¸¥à¹ˆà¸²à¸‡
--
--   -- Preflight: à¸«à¸² policy à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰à¸à¸¥à¹„à¸à¹€à¸”à¸´à¸¡ (user_metadata) à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰à¸‡à¸²à¸™à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸ˆà¸£à¸´à¸‡
--   select schemaname, tablename, policyname, cmd
--   from pg_policies
--   where qual::text like '%user_metadata%' or with_check::text like '%user_metadata%'
--   order by tablename, policyname;
--
--   -- Preflight: à¸«à¸² policy à¸‹à¹‰à¸³à¸‹à¹‰à¸­à¸™à¸‚à¸­à¸‡ partner_packages (à¸„à¸²à¸”à¸§à¹ˆà¸²à¸¡à¸µ 4 à¸•à¸±à¸§à¸ˆà¸²à¸à¸•à¸­à¸™ rename)
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where tablename = 'partner_packages';
-- ============================================================

-- ============================================================
-- 1. HELPER FUNCTIONS (SECURITY DEFINER)
--    à¹ƒà¸Šà¹‰à¹à¸—à¸™à¸à¸²à¸£à¹€à¸‚à¸µà¸¢à¸™ subquery à¸‹à¹‰à¸³à¸—à¸¸à¸ policy à¸‚à¸­à¸‡à¸à¸¥à¸¸à¹ˆà¸¡ B
--    SECURITY DEFINER à¹€à¸žà¸·à¹ˆà¸­ bypass RLS à¸•à¸­à¸™ query à¸ à¸²à¸¢à¹ƒà¸™à¸Ÿà¸±à¸‡à¸à¹Œà¸Šà¸±à¸™à¹€à¸­à¸‡
--    (à¸à¸±à¸™ infinite recursion à¸•à¸­à¸™à¹€à¸Šà¹‡à¸„ policy à¸‚à¸­à¸‡à¸•à¸²à¸£à¸²à¸‡ users à¸—à¸µà¹ˆ query à¸•à¸±à¸§à¹€à¸­à¸‡)
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
-- 2. à¹à¸à¹‰ policy à¸‚à¸­à¸‡ packages (à¸à¸¥à¸¸à¹ˆà¸¡ A €” à¸•à¸±à¸§à¸ˆà¸£à¸´à¸‡à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰ partner_id)
--    à¸šà¸±à¹Šà¸: correlated subquery à¹€à¸”à¸´à¸¡à¸­à¹‰à¸²à¸‡à¸­à¸´à¸‡ packages.partner_id à¸‚à¸­à¸‡à¹à¸–à¸§à¸•à¸±à¸§à¹€à¸­à¸‡
--    à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¸„à¸­à¸¥à¸±à¸¡à¸™à¹Œà¸‚à¸­à¸‡ users †’ à¸à¸¥à¸²à¸¢à¹€à¸›à¹‡à¸™ tautology à¸—à¸µà¹ˆà¸œà¹ˆà¸²à¸™à¹€à¸ªà¸¡à¸­à¹„à¸¡à¹ˆà¸§à¹ˆà¸² user à¹€à¸›à¹‡à¸™à¹ƒà¸„à¸£
--    (à¸Šà¹ˆà¸­à¸‡à¹‚à¸«à¸§à¹ˆà¸„à¸§à¸²à¸¡à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢à¸‚à¹‰à¸²à¸¡à¸šà¸±à¸à¸Šà¸µ €” à¸”à¸¹ PROJECT_STRUCTURE.md à¸‚à¹‰à¸­ 5.1)
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
-- 3. à¹€à¸„à¸¥à¸µà¸¢à¸£à¹Œ policy à¸‹à¹‰à¸³à¸‹à¹‰à¸­à¸™à¸‚à¸­à¸‡ partner_packages
--    (à¹€à¸à¸´à¸”à¸ˆà¸²à¸à¸•à¸­à¸™ rename à¸•à¸²à¸£à¸²à¸‡ sql/004 €” à¸¡à¸µ policy à¸—à¸³à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆà¹€à¸”à¸´à¸¡à¸‹à¹‰à¸³à¸à¸±à¸™ ~4 à¸•à¸±à¸§)
--    à¸Šà¸·à¹ˆà¸­à¸”à¹‰à¸²à¸™à¸¥à¹ˆà¸²à¸‡à¸„à¸·à¸­à¸Šà¸·à¹ˆà¸­à¸—à¸µà¹ˆà¸„à¸²à¸”à¸§à¹ˆà¸²à¸¡à¸²à¸ˆà¸²à¸ RLS_Policy_.sql / SQL_DDL à¹€à¸”à¸´à¸¡
--    à¸–à¹‰à¸² preflight query à¹€à¸ˆà¸­à¸Šà¸·à¹ˆà¸­à¸­à¸·à¹ˆà¸™ à¹ƒà¸«à¹‰à¹€à¸žà¸´à¹ˆà¸¡ DROP POLICY IF EXISTS à¹€à¸­à¸‡à¸à¹ˆà¸­à¸™à¸£à¸±à¸™ CREATE
-- ============================================================

DROP POLICY IF EXISTS "Users can view their organization's packages" ON public.partner_packages;
DROP POLICY IF EXISTS "Users can manage their organization's packages" ON public.partner_packages;

CREATE POLICY "Users can view their organization's packages" ON public.partner_packages
    FOR SELECT USING (organization_id = public.current_user_organization_id());

CREATE POLICY "Users can manage their organization's packages" ON public.partner_packages
    FOR ALL USING (organization_id = public.current_user_organization_id());

-- ============================================================
-- 4. organizations / branches / users
--    à¹€à¸”à¸´à¸¡à¹ƒà¸Šà¹‰ auth.jwt() -> 'user_metadata' ->> 'organization_id' à¸‹à¸¶à¹ˆà¸‡à¹„à¸¡à¹ˆà¹€à¸„à¸¢à¸–à¸¹à¸ set
--    à¹ƒà¸«à¹‰ user à¸ˆà¸£à¸´à¸‡à¹€à¸¥à¸¢ †’ à¸šà¸¥à¹‡à¸­à¸à¸—à¸¸à¸à¸„à¸™à¹à¸šà¸šà¹€à¸‡à¸µà¸¢à¸šà¹† à¸¡à¸²à¸•à¸¥à¸­à¸”
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
-- 6. partner_bookings (à¹€à¸”à¸´à¸¡à¸Šà¸·à¹ˆà¸­ policy à¸­à¹‰à¸²à¸‡à¸•à¸²à¸£à¸²à¸‡ "bookings" à¸•à¸­à¸™à¸¢à¸±à¸‡à¹„à¸¡à¹ˆ rename)
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
--    à¹€à¸”à¸´à¸¡ insert/update à¹ƒà¸Šà¹‰ JWT user_metadata à¸—à¸µà¹ˆà¹„à¸¡à¹ˆà¹€à¸„à¸¢à¸–à¸¹à¸à¹€à¸‹à¹‡à¸• †’ à¸šà¸¥à¹‡à¸­à¸à¸—à¸¸à¸à¸„à¸™
-- ============================================================

DROP POLICY IF EXISTS "Users can view their organization's subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view their organization's subscriptions" ON public.subscriptions
    FOR SELECT USING (organization_id = public.current_user_organization_id());

CREATE POLICY "Users can manage their organization's subscriptions" ON public.subscriptions
    FOR ALL USING (organization_id = public.current_user_organization_id());

-- ============================================================
-- 9. notifications
--    SELECT/UPDATE à¸œà¹ˆà¸²à¸™ helper function, INSERT à¸¢à¸±à¸‡à¸œà¹ˆà¸²à¸™ service role à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™ (à¸•à¸±à¹‰à¸‡à¹ƒà¸ˆ)
-- ============================================================

DROP POLICY IF EXISTS "Users can view their organization's notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their organization's notifications" ON public.notifications;

CREATE POLICY "Users can view their organization's notifications" ON public.notifications
    FOR SELECT USING (organization_id = public.current_user_organization_id());

CREATE POLICY "Users can update their organization's notifications" ON public.notifications
    FOR UPDATE USING (organization_id = public.current_user_organization_id());

-- ============================================================
-- 10. à¹à¸à¹‰ FK à¸‚à¸­à¸‡ partner_bookings à¹ƒà¸«à¹‰à¸Šà¸µà¹‰à¹„à¸› packages(id) à¹à¸—à¸™ partner_packages(id)
--     (à¸Šà¸·à¹ˆà¸­ constraint à¹€à¸”à¸´à¸¡à¹„à¸¡à¹ˆà¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ à¹à¸„à¹ˆà¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ target table €” à¸”à¸¹ PROJECT_STRUCTURE.md à¸‚à¹‰à¸­ 5.5)
--     à¹€à¸Šà¹‡à¸„à¸à¹ˆà¸­à¸™à¸£à¸±à¸™à¸ˆà¸£à¸´à¸‡: à¸•à¸­à¸™à¹à¸à¹‰à¸„à¸£à¸±à¹‰à¸‡à¹à¸£à¸ total_bookings = 0 à¸ˆà¸¶à¸‡à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢à¸—à¸µà¹ˆà¸ˆà¸°à¹à¸à¹‰à¸•à¸£à¸‡à¹†
--     à¸–à¹‰à¸²à¸¡à¸µà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸£à¸´à¸‡à¹à¸¥à¹‰à¸§ à¹ƒà¸«à¹‰à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸§à¹ˆà¸² package_id à¸—à¸¸à¸à¹à¸–à¸§à¸¡à¸µà¸­à¸¢à¸¹à¹ˆà¸ˆà¸£à¸´à¸‡à¹ƒà¸™ packages à¸à¹ˆà¸­à¸™ ALTER
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
-- 11. Postflight sanity check €” à¸£à¸±à¸™à¸«à¸¥à¸±à¸‡à¹ƒà¸Šà¹‰ migration à¸™à¸µà¹‰à¹€à¸žà¸·à¹ˆà¸­à¸¢à¸·à¸™à¸¢à¸±à¸™à¸§à¹ˆà¸²à¹„à¸¡à¹ˆà¸¡à¸µ policy
--     à¸—à¸µà¹ˆà¸¢à¸±à¸‡à¸žà¸¶à¹ˆà¸‡ user_metadata à¸«à¸¥à¸‡à¹€à¸«à¸¥à¸·à¸­à¸­à¸¢à¸¹à¹ˆ
-- ============================================================

--   select tablename, policyname
--   from pg_policies
--   where qual::text like '%user_metadata%' or with_check::text like '%user_metadata%';
--   -- à¸„à¸§à¸£à¹„à¸”à¹‰ 0 à¹à¸–à¸§
