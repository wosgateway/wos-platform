-- ============================================================
-- 004_partner_packages_and_bookings.sql
-- ============================================================
-- š ï¸ RECONSTRUCTED SNAPSHOT €” à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¹„à¸Ÿà¸¥à¹Œ migration à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¸ˆà¸£à¸´à¸‡
--
-- à¹„à¸Ÿà¸¥à¹Œà¸™à¸µà¹‰à¸–à¸¹à¸à¸›à¸£à¸°à¸à¸­à¸šà¸‚à¸¶à¹‰à¸™à¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡à¸ˆà¸²à¸à¸à¸²à¸£ query schema à¸ˆà¸£à¸´à¸‡à¸šà¸™ Supabase
-- (information_schema + pg_catalog) à¹€à¸¡à¸·à¹ˆà¸­ 2026-08-02 à¹€à¸™à¸·à¹ˆà¸­à¸‡à¸ˆà¸²à¸ migration
-- à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¸—à¸µà¹ˆà¹€à¸„à¸¢à¸£à¸±à¸™à¸•à¸£à¸‡à¹ƒà¸™ SQL Editor à¹„à¸¡à¹ˆà¹€à¸„à¸¢à¸–à¸¹à¸à¸šà¸±à¸™à¸—à¸¶à¸à¹€à¸›à¹‡à¸™à¹„à¸Ÿà¸¥à¹Œà¹ƒà¸™à¹‚à¸›à¸£à¹€à¸ˆà¸à¸•à¹Œ
-- à¸¡à¸²à¸à¹ˆà¸­à¸™ (à¸”à¸¹à¸šà¸£à¸´à¸šà¸—à¹ƒà¸™ CLAUDE_MEMORY: à¹€à¸”à¸´à¸¡à¹€à¸£à¸µà¸¢à¸à¸à¸±à¸™à¸§à¹ˆà¸²
-- "004_fix_packages_collision.sql" à¸•à¸­à¸™à¹à¸à¹‰à¸›à¸±à¸à¸«à¸² 001_schema_and_rls.sql
-- à¹„à¸› DROP à¸•à¸²à¸£à¸²à¸‡ packages à¹€à¸”à¸´à¸¡à¸—à¸±à¸šà¸à¸±à¸šà¸‚à¸­à¸‡à¸£à¸°à¸šà¸šà¸„à¸¥à¸´à¸™à¸´à¸)
--
-- à¸ªà¸´à¹ˆà¸‡à¸—à¸µà¹ˆà¹€à¸à¸´à¸”à¸‚à¸¶à¹‰à¸™à¸ˆà¸£à¸´à¸‡à¸•à¸²à¸¡à¸—à¸µà¹ˆ schema à¸›à¸±à¸ˆà¸ˆà¸¸à¸šà¸±à¸™à¸ªà¸°à¸—à¹‰à¸­à¸™à¹„à¸§à¹‰:
-- - à¸•à¸²à¸£à¸²à¸‡ "packages" (à¸„à¸¥à¸´à¸™à¸´à¸, service à¹€à¸”à¸´à¸¡) à¸–à¸¹à¸à¸„à¸‡/à¸ªà¸£à¹‰à¸²à¸‡à¹ƒà¸«à¸¡à¹ˆà¹à¸¢à¸à¹„à¸§à¹‰
-- - Partner portal à¹ƒà¸Šà¹‰à¸•à¸²à¸£à¸²à¸‡à¸Šà¸·à¹ˆà¸­ "partner_packages" à¹à¸¥à¸° "partner_bookings"
--   à¹à¸—à¸™ à¹€à¸žà¸·à¹ˆà¸­à¹„à¸¡à¹ˆà¹ƒà¸«à¹‰à¸Šà¸™à¸à¸±à¸šà¸‚à¸­à¸‡à¹€à¸”à¸´à¸¡ (à¸Šà¸·à¹ˆà¸­ constraint à¸šà¸²à¸‡à¸•à¸±à¸§à¸¢à¸±à¸‡à¹€à¸›à¹‡à¸™
--   "packages_*"/"bookings_*" à¹€à¸žà¸£à¸²à¸° RENAME TABLE à¹„à¸¡à¹ˆà¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸Šà¸·à¹ˆà¸­ constraint
--   à¹€à¸”à¸´à¸¡à¹ƒà¸«à¹‰à¸­à¸±à¸•à¹‚à¸™à¸¡à¸±à¸•à¸´ €” à¸„à¸‡à¹„à¸§à¹‰à¸•à¸²à¸¡à¸ˆà¸£à¸´à¸‡ à¹„à¸¡à¹ˆà¹à¸à¹‰à¹„à¸‚)
--
-- à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢à¸—à¸µà¹ˆà¸ˆà¸°à¸£à¸±à¸™à¸‹à¹‰à¸³ (idempotent) à¹€à¸žà¸£à¸²à¸°à¹ƒà¸Šà¹‰ IF NOT EXISTS / OR REPLACE
-- à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸” €” à¸£à¸±à¸™à¸à¸±à¸š database à¸—à¸µà¹ˆà¸¡à¸µà¸­à¸¢à¸¹à¹ˆà¹à¸¥à¹‰à¸§à¸ˆà¸°à¹„à¸¡à¹ˆ error à¹à¸¥à¸°à¹„à¸¡à¹ˆà¸—à¸³à¸¥à¸²à¸¢à¸‚à¹‰à¸­à¸¡à¸¹à¸¥
-- ============================================================

-- ------------------------------------------------------------
-- Helper function à¹ƒà¸Šà¹‰à¹ƒà¸™ RLS à¸‚à¸­à¸‡à¸ªà¸­à¸‡à¸•à¸²à¸£à¸²à¸‡à¸™à¸µà¹‰ (à¸„à¸™à¸¥à¸°à¹à¸šà¸šà¸à¸±à¸š 001 à¸—à¸µà¹ˆà¹€à¸Šà¹‡à¸„
-- auth.jwt() à¸•à¸£à¸‡à¹† €” à¸•à¸±à¸§à¸™à¸µà¹‰ query à¸ˆà¸²à¸ public.users à¹à¸—à¸™)
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
-- à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸: package_id / transport_package_id / hotel_package_id
-- à¸¢à¸±à¸‡à¸­à¹‰à¸²à¸‡à¸­à¸´à¸‡à¹„à¸›à¸—à¸µà¹ˆ public.packages (à¸•à¸²à¸£à¸²à¸‡à¸„à¸¥à¸´à¸™à¸´à¸à¹€à¸”à¸´à¸¡) à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ
-- partner_packages €” à¸™à¸µà¹ˆà¸„à¸·à¸­à¸ªà¸ à¸²à¸žà¸ˆà¸£à¸´à¸‡à¸‚à¸­à¸‡ FK à¹ƒà¸™à¸à¸²à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸›à¸±à¸ˆà¸ˆà¸¸à¸šà¸±à¸™
-- (à¸„à¸‡à¹„à¸§à¹‰à¸•à¸²à¸¡à¸ˆà¸£à¸´à¸‡ à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹à¸à¹‰à¹ƒà¸«à¹‰à¸•à¸£à¸‡à¸à¸±à¸šà¸—à¸µà¹ˆ "à¸„à¸§à¸£à¸ˆà¸°à¹€à¸›à¹‡à¸™" à¹€à¸žà¸£à¸²à¸°à¸à¸²à¸£à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ FK
-- target à¸•à¸­à¸™à¸™à¸µà¹‰à¸­à¸²à¸ˆà¸à¸£à¸°à¸—à¸š query/RLS à¸­à¸·à¹ˆà¸™à¸—à¸µà¹ˆà¸œà¸¹à¸à¸­à¸¢à¸¹à¹ˆ €” à¸„à¸§à¸£à¸•à¸±à¸”à¸ªà¸´à¸™à¹ƒà¸ˆà¸£à¹ˆà¸§à¸¡à¸à¸±à¸š
-- à¸—à¸µà¸¡à¸à¹ˆà¸­à¸™à¹à¸à¹‰ à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸—à¸³à¹ƒà¸™à¹„à¸Ÿà¸¥à¹Œà¸™à¸µà¹‰)
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
