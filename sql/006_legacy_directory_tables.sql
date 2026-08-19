-- ============================================================
-- 006_legacy_directory_tables.sql
-- ============================================================
-- š ï¸ RECONSTRUCTED SNAPSHOT €” à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¹„à¸Ÿà¸¥à¹Œ migration à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¸ˆà¸£à¸´à¸‡
-- à¸›à¸£à¸°à¸à¸­à¸šà¸‚à¸¶à¹‰à¸™à¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡à¸ˆà¸²à¸ schema à¸ˆà¸£à¸´à¸‡à¸šà¸™ Supabase à¹€à¸¡à¸·à¹ˆà¸­ 2026-08-02
--
-- à¸•à¸²à¸£à¸²à¸‡à¹ƒà¸™à¹„à¸Ÿà¸¥à¹Œà¸™à¸µà¹‰ (cases, partners) à¸”à¸¹à¸ˆà¸²à¸à¹‚à¸„à¸£à¸‡à¸ªà¸£à¹‰à¸²à¸‡à¹à¸¥à¹‰à¸§à¹€à¸›à¹‡à¸™à¸‚à¸­à¸‡à¸£à¸°à¸šà¸šà¹€à¸”à¸´à¸¡
-- à¸à¹ˆà¸­à¸™à¹€à¸£à¸´à¹ˆà¸¡à¸—à¸³ partner portal (à¹„à¸¡à¹ˆà¸¡à¸µ organization_id, à¹„à¸¡à¹ˆà¸œà¸¹à¸à¸à¸±à¸šà¸£à¸°à¸šà¸š
-- multi-tenant à¹€à¸«à¸¡à¸·à¸­à¸™à¸•à¸²à¸£à¸²à¸‡à¸­à¸·à¹ˆà¸™) €” à¹„à¸¡à¹ˆà¹€à¸„à¸¢à¸–à¸¹à¸à¸šà¸±à¸™à¸—à¸¶à¸à¹„à¸§à¹‰à¹ƒà¸™à¹„à¸Ÿà¸¥à¹Œ migration
-- à¹„à¸«à¸™à¸¡à¸²à¸à¹ˆà¸­à¸™à¹€à¸¥à¸¢ à¹€à¸à¹‡à¸šà¹„à¸§à¹‰à¹€à¸žà¸·à¹ˆà¸­à¹ƒà¸«à¹‰ repo à¸•à¸£à¸‡à¸à¸±à¸š database à¸ˆà¸£à¸´à¸‡à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”
--
-- š ï¸ à¸„à¹ˆà¸² DEFAULT à¸šà¸²à¸‡à¸•à¸±à¸§à¹ƒà¸™à¸•à¸²à¸£à¸²à¸‡ "cases" (status, hospital, case_no) à¸•à¸­à¸™
-- export à¸­à¸­à¸à¸¡à¸²à¸ˆà¸²à¸ information_schema à¸¡à¸µà¸¥à¸±à¸à¸©à¸“à¸° quote à¸‹à¹‰à¸­à¸™à¸à¸±à¸™à¹à¸›à¸¥à¸à¹†
-- (à¸œà¸¥à¸¥à¸±à¸žà¸˜à¹Œà¸ˆà¸²à¸ query à¸­à¸²à¸ˆà¸–à¸¹à¸ escape à¸‹à¹‰à¸³à¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡à¸—à¸²à¸‡) à¹„à¸Ÿà¸¥à¹Œà¸™à¸µà¹‰à¹ƒà¸Šà¹‰à¸„à¹ˆà¸²à¸—à¸µà¹ˆà¸—à¸³à¸„à¸§à¸²à¸¡
-- à¸ªà¸°à¸­à¸²à¸”à¹à¸¥à¹‰à¸§à¸•à¸²à¸¡à¸„à¸§à¸²à¸¡à¸«à¸¡à¸²à¸¢à¸—à¸µà¹ˆà¸™à¹ˆà¸²à¸ˆà¸°à¹€à¸›à¹‡à¸™à¸ˆà¸£à¸´à¸‡ €” à¸–à¹‰à¸²à¸•à¹‰à¸­à¸‡à¸žà¸¶à¹ˆà¸‡à¸„à¹ˆà¸² default à¸•à¸£à¸‡à¸™à¸µà¹‰
-- à¹à¸šà¸šà¹€à¸›à¹Šà¸°à¹† à¸„à¸§à¸£à¹€à¸Šà¹‡à¸„à¸à¸±à¸š production à¸­à¸µà¸à¸„à¸£à¸±à¹‰à¸‡à¸”à¹‰à¸§à¸¢:
--   select column_name, column_default from information_schema.columns
--   where table_name = 'cases';
--
-- à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢à¸—à¸µà¹ˆà¸ˆà¸°à¸£à¸±à¸™à¸‹à¹‰à¸³ (idempotent) €” à¹ƒà¸Šà¹‰ IF NOT EXISTS à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”
-- ============================================================

-- ------------------------------------------------------------
-- cases €” à¹à¸šà¸šà¸Ÿà¸­à¸£à¹Œà¸¡ lead-capture à¸ªà¸²à¸˜à¸²à¸£à¸“à¸° (à¹„à¸¡à¹ˆà¸œà¸¹à¸ organization à¹ƒà¸”à¹†,
-- à¹€à¸›à¸´à¸”à¹ƒà¸«à¹‰ anon à¹€à¸‚à¸µà¸¢à¸™/à¸­à¹ˆà¸²à¸™/à¹à¸à¹‰à¹„à¸‚à¹„à¸”à¹‰à¸•à¸£à¸‡à¹† à¸œà¹ˆà¸²à¸™ RLS €” à¹€à¸›à¹‡à¸™à¹à¸šà¸šà¸Ÿà¸­à¸£à¹Œà¸¡à¸•à¸´à¸”à¸•à¹ˆà¸­
-- à¸ªà¸²à¸˜à¸²à¸£à¸“à¸° à¹€à¸Šà¹ˆà¸™ become-partner à¸«à¸£à¸·à¸­ price-inquiry)
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

-- à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸: à¸¡à¸µ INSERT policy à¸­à¸¢à¸¹à¹ˆ 2 à¸­à¸±à¸™ à¸—à¸³à¸‡à¸²à¸™à¸‹à¹‰à¸³à¸‹à¹‰à¸­à¸™à¸à¸±à¸™ (à¸„à¸™à¸¥à¸°à¸Šà¸·à¹ˆà¸­
-- à¹à¸•à¹ˆà¹€à¸‡à¸·à¹ˆà¸­à¸™à¹„à¸‚à¹€à¸«à¸¡à¸·à¸­à¸™à¸à¸±à¸™) à¸„à¸‡à¹„à¸§à¹‰à¸•à¸²à¸¡à¸ˆà¸£à¸´à¸‡à¹ƒà¸™à¸à¸²à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸›à¸±à¸ˆà¸ˆà¸¸à¸šà¸±à¸™ à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸¥à¸šà¸­à¸­à¸
-- à¹€à¸žà¸£à¸²à¸°à¸à¸²à¸£à¸¥à¸šà¸­à¸²à¸ˆà¸à¸£à¸°à¸—à¸šà¸žà¸¤à¸•à¸´à¸à¸£à¸£à¸¡à¸—à¸µà¹ˆà¸—à¸µà¸¡à¸­à¸·à¹ˆà¸™à¸žà¸¶à¹ˆà¸‡à¸žà¸²à¸­à¸¢à¸¹à¹ˆà¹‚à¸”à¸¢à¹„à¸¡à¹ˆà¸£à¸¹à¹‰à¸•à¸±à¸§
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
-- partners €” à¸ªà¸²à¸£à¸šà¸šà¸žà¸²à¸£à¹Œà¸—à¹€à¸™à¸­à¸£à¹Œà¹à¸šà¸š public directory (à¹à¸ªà¸”à¸‡à¸«à¸™à¹‰à¸²
-- become-partner / partner listing à¸à¸±à¹ˆà¸‡à¸œà¸¹à¹‰à¹€à¸¢à¸µà¹ˆà¸¢à¸¡à¸Šà¸¡à¹€à¸§à¹‡à¸š) à¸„à¸™à¸¥à¸°à¹à¸™à¸§à¸„à¸´à¸”à¸à¸±à¸š
-- public.organizations à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰à¸œà¸¹à¸ partner portal login
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

-- à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸: à¹€à¸Šà¹ˆà¸™à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸š cases à¸¡à¸µ policy à¸‹à¹‰à¸³à¸‹à¹‰à¸­à¸™à¸à¸±à¸™à¸«à¸¥à¸²à¸¢à¸­à¸±à¸™ (ALL x2,
-- SELECT x2) à¸„à¸‡à¹„à¸§à¹‰à¸•à¸²à¸¡à¸ˆà¸£à¸´à¸‡à¹ƒà¸™à¸à¸²à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸›à¸±à¸ˆà¸ˆà¸¸à¸šà¸±à¸™à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”
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
