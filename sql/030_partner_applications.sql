-- ============================================================================
-- 030_partner_applications.sql
--
-- à¸—à¸µà¹ˆà¸¡à¸²: à¹à¸›à¸¥à¸‡à¸ˆà¸²à¸ Prisma schema (deepseek_prisma_20260811_dedfa0.txt) à¹€à¸‰à¸žà¸²à¸°
-- model `PartnerApplication` à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™
--
-- à¸•à¸£à¸§à¸ˆà¸à¸±à¸š sql.rar (migration à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¸ˆà¸£à¸´à¸‡ 001-029) à¹à¸¥à¹‰à¸§à¸à¹ˆà¸­à¸™à¹€à¸‚à¸µà¸¢à¸™à¹„à¸Ÿà¸¥à¹Œà¸™à¸µà¹‰:
--   - à¹€à¸¥à¸‚à¹„à¸Ÿà¸¥à¹Œà¸¥à¹ˆà¸²à¸ªà¸¸à¸”à¸„à¸·à¸­ 029 †’ à¹„à¸Ÿà¸¥à¹Œà¸™à¸µà¹‰à¹ƒà¸Šà¹‰à¹€à¸¥à¸‚ 030 à¸•à¹ˆà¸­
--   - Trigger function à¸ªà¸³à¸«à¸£à¸±à¸š updated_at à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰à¸ˆà¸£à¸´à¸‡à¸—à¸±à¹‰à¸‡à¹‚à¸›à¸£à¹€à¸ˆà¸à¸•à¹Œà¸„à¸·à¸­
--     public.handle_updated_at() (à¸”à¸¹ 001_schema_and_rls.sql)
--   - à¸ˆà¸‡à¹ƒà¸ˆà¹„à¸¡à¹ˆà¹à¸›à¸¥à¸‡ model à¸­à¸·à¹ˆà¸™à¸ˆà¸²à¸ Prisma schema (Partner, Booking, Case,
--     MOUDocument) à¹€à¸žà¸£à¸²à¸°à¸¡à¸µà¸•à¸²à¸£à¸²à¸‡à¸—à¸µà¹ˆà¸—à¸³à¸«à¸™à¹‰à¸²à¸—à¸µà¹ˆà¸„à¸¥à¹‰à¸²à¸¢à¸à¸±à¸™à¸­à¸¢à¸¹à¹ˆà¸ˆà¸£à¸´à¸‡à¹ƒà¸™
--     006_legacy_directory_tables.sql (public.cases, public.partners)
--
-- RLS: à¹à¸à¹‰à¸ˆà¸²à¸à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¹à¸£à¸à¹à¸¥à¹‰à¸§ €” à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¹à¸£à¸à¹ƒà¸Šà¹‰ "authenticated using (true)"
-- à¸ªà¸³à¸«à¸£à¸±à¸š SELECT/UPDATE à¸‹à¸¶à¹ˆà¸‡à¸„à¸£à¸­à¸šà¸„à¸¥à¸¸à¸¡à¸—à¸¸à¸à¸„à¸™à¸—à¸µà¹ˆ login à¸œà¹ˆà¸²à¸™ Supabase Auth pool
-- à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸™ à¸£à¸§à¸¡à¸–à¸¶à¸‡ staff à¸‚à¸­à¸‡à¸žà¸²à¸£à¹Œà¸—à¹€à¸™à¸­à¸£à¹Œà¹€à¸­à¸‡ (login à¸œà¹ˆà¸²à¸™ (partner-portal), à¸”à¸¹
-- src/lib/partner/auth.ts) à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¹à¸„à¹ˆ WOS staff €” à¹à¸à¹‰à¹€à¸›à¹‡à¸™ is_platform_admin()
-- à¸•à¸±à¹‰à¸‡à¹à¸•à¹ˆà¸ªà¸£à¹‰à¸²à¸‡à¸•à¸²à¸£à¸²à¸‡à¸™à¸µà¹‰à¹€à¸¥à¸¢ (à¸Ÿà¸±à¸‡à¸à¹Œà¸Šà¸±à¸™à¸™à¸µà¹‰à¸¡à¸µà¸­à¸¢à¸¹à¹ˆà¹à¸¥à¹‰à¸§à¹ƒà¸™à¸£à¸°à¸šà¸š à¹ƒà¸Šà¹‰à¸ˆà¸£à¸´à¸‡à¸à¸±à¸š RLS à¸‚à¸­à¸‡
-- public.packages/public.partners à¹à¸¥à¸°à¸•à¸£à¸§à¸ˆà¸à¸±à¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸£à¸´à¸‡à¹à¸¥à¹‰à¸§à¸§à¹ˆà¸²à¹à¸¢à¸ org-admin
-- à¸­à¸­à¸à¸ˆà¸²à¸ platform-admin à¹„à¸”à¹‰à¸–à¸¹à¸à¸•à¹‰à¸­à¸‡à¹à¸¡à¹‰à¸­à¸¢à¸¹à¹ˆ organization à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸™)
--
-- à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢à¸—à¸µà¹ˆà¸ˆà¸°à¸£à¸±à¸™à¸‹à¹‰à¸³ (idempotent) €” à¹ƒà¸Šà¹‰ IF NOT EXISTS / OR REPLACE à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”
-- à¹„à¸¡à¹ˆà¹à¸•à¸°à¸•à¸²à¸£à¸²à¸‡/policy à¹ƒà¸”à¹† à¸—à¸µà¹ˆà¸¡à¸µà¸­à¸¢à¸¹à¹ˆà¹à¸¥à¹‰à¸§ à¸¡à¸µà¹à¸•à¹ˆ "à¹€à¸žà¸´à¹ˆà¸¡" à¸•à¸²à¸£à¸²à¸‡à¹ƒà¸«à¸¡à¹ˆà¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™
-- ============================================================================

-- --------------------------------------------------------------------------
-- à¸•à¸²à¸£à¸²à¸‡ partner_applications
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_applications (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    language               TEXT NOT NULL DEFAULT 'th'
                           CHECK (language IN ('th', 'en', 'lo')),

    company_name           TEXT NOT NULL,
    registration_number    TEXT,
    tax_id                 TEXT,
    business_type          TEXT NOT NULL
                           CHECK (business_type IN (
                               'clinic_hospital', 'hotel_resort',
                               'transport_agent', 'investor'
                           )),
    year_established       INTEGER,
    employee_count         INTEGER,

    primary_name            TEXT NOT NULL,
    primary_title            TEXT,
    primary_email            TEXT,
    primary_phone            TEXT NOT NULL,
    primary_line_id          TEXT,

    secondary_name           TEXT,
    secondary_email          TEXT,
    secondary_phone          TEXT,

    address                 TEXT,
    district                TEXT,
    province                TEXT,
    postal_code             TEXT,
    country                 TEXT DEFAULT 'Thailand',

    service_types           TEXT[] NOT NULL DEFAULT '{}',
    specialties              TEXT[] NOT NULL DEFAULT '{}',
    languages                TEXT[] NOT NULL DEFAULT '{}',
    operating_hours          TEXT,
    capacity                 INTEGER,

    business_license_url       TEXT,
    tax_certificate_url        TEXT,
    insurance_certificate_url  TEXT,
    other_documents             TEXT[] NOT NULL DEFAULT '{}',

    accept_terms             BOOLEAN NOT NULL DEFAULT false,
    accept_privacy            BOOLEAN NOT NULL DEFAULT false,
    accept_sla                BOOLEAN NOT NULL DEFAULT false,

    message                  TEXT,

    status                   TEXT NOT NULL DEFAULT 'PENDING'
                             CHECK (status IN (
                                 'PENDING', 'UNDER_REVIEW', 'NEEDS_INFO',
                                 'APPROVED', 'REJECTED'
                             )),
    reviewed_by               TEXT,
    reviewed_at                TIMESTAMPTZ,
    internal_notes             TEXT,

    submitted_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address                 TEXT,
    user_agent                  TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_applications_status
    ON public.partner_applications(status);

CREATE INDEX IF NOT EXISTS idx_partner_applications_business_type
    ON public.partner_applications(business_type);

CREATE INDEX IF NOT EXISTS idx_partner_applications_submitted_at
    ON public.partner_applications(submitted_at DESC);

-- --------------------------------------------------------------------------
-- Trigger €” reuse public.handle_updated_at()
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_partner_applications
    ON public.partner_applications;

CREATE TRIGGER set_updated_at_partner_applications
    BEFORE UPDATE ON public.partner_applications
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------------------------------------
-- Row Level Security
--
--   - INSERT: anon + authenticated (à¸Ÿà¸­à¸£à¹Œà¸¡à¸ªà¸²à¸˜à¸²à¸£à¸“à¸° /become-partner à¹„à¸¡à¹ˆ login)
--   - SELECT/UPDATE/DELETE: à¹€à¸‰à¸žà¸²à¸° is_platform_admin() (WOS staff à¸ˆà¸£à¸´à¸‡à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™
--     €” à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ "authenticated" à¹€à¸‰à¸¢à¹† à¸‹à¸¶à¹ˆà¸‡à¸ˆà¸°à¸„à¸£à¸­à¸šà¸„à¸¥à¸¸à¸¡ org-admin à¸‚à¸­à¸‡à¸žà¸²à¸£à¹Œà¸—à¹€à¸™à¸­à¸£à¹Œà¸”à¹‰à¸§à¸¢)
-- --------------------------------------------------------------------------
ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public insert on partner_applications" ON public.partner_applications;
CREATE POLICY "Allow public insert on partner_applications" ON public.partner_applications
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can select partner_applications" ON public.partner_applications;
DROP POLICY IF EXISTS "Authenticated can update partner_applications" ON public.partner_applications;
DROP POLICY IF EXISTS "Platform admins can manage partner_applications" ON public.partner_applications;
CREATE POLICY "Platform admins can manage partner_applications" ON public.partner_applications
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

-- ============================================================================
-- VERIFY after running:
--   select policyname, roles, cmd, qual from pg_policies where tablename = 'partner_applications';
-- à¸„à¸§à¸£à¹„à¸”à¹‰ 2 à¹à¸–à¸§: INSERT (anon,authenticated) / ALL (authenticated, qual: is_platform_admin())
-- ============================================================================
