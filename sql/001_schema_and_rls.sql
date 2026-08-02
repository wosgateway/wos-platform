-- ============================================================
-- PARTNER PORTAL SCHEMA + RLS (ALL-IN-ONE)
-- ============================================================

-- 1. DROP EXISTING POLICIES (เพื่อป้องกัน error)
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN (
    SELECT policyname, tablename 
    FROM pg_policies 
    WHERE schemaname = 'public'
    AND policyname LIKE 'Users can%'
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- 2. DROP TABLES (ถ้ามี) เพื่อสร้างใหม่ทั้งหมด
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.bookings CASCADE;
DROP TABLE IF EXISTS public.patients CASCADE;
DROP TABLE IF EXISTS public.packages CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.branches CASCADE;
DROP TABLE IF EXISTS public.organizations CASCADE;

-- 3. CREATE TABLES
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    logo_url TEXT,
    cover_image_url TEXT,
    description TEXT,
    website_url TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    province TEXT,
    country TEXT DEFAULT 'Thailand',
    settings JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'active',
    tier TEXT DEFAULT 'free',
    subscription_status TEXT DEFAULT 'active',
    trial_ends_at TIMESTAMPTZ,
    subscription_ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT,
    province TEXT,
    phone TEXT,
    email TEXT,
    latitude NUMERIC(10, 8),
    longitude NUMERIC(11, 8),
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    supabase_user_id UUID UNIQUE,
    full_name TEXT NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'staff',
    permissions JSONB DEFAULT '[]'::jsonb,
    avatar_url TEXT,
    status TEXT DEFAULT 'active',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.packages (
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

CREATE TABLE public.patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    line_id TEXT,
    country TEXT,
    preferred_language TEXT DEFAULT 'th',
    birth_date DATE,
    gender TEXT,
    medical_notes TEXT,
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
    booking_date DATE NOT NULL,
    booking_time TIME,
    need_transport BOOLEAN DEFAULT false,
    transport_package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
    transport_mode TEXT,
    transport_pickup_date DATE,
    transport_pickup_time TIME,
    transport_return_date DATE,
    transport_return_time TIME,
    transport_days INTEGER,
    need_hotel BOOLEAN DEFAULT false,
    hotel_package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
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

CREATE TABLE public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    category TEXT,
    description TEXT,
    uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    expiry_date DATE,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    tier TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    payment_provider TEXT,
    payment_provider_id TEXT,
    payment_amount NUMERIC(12, 2),
    payment_currency TEXT DEFAULT 'THB',
    features JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ✅ NOTIFICATIONS TABLE (เพิ่มให้ครบ)
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. INDEXES
CREATE INDEX idx_organizations_slug ON public.organizations(slug);
CREATE INDEX idx_branches_org_id ON public.branches(organization_id);
CREATE INDEX idx_users_org_id ON public.users(organization_id);
CREATE INDEX idx_users_email ON public.users(email);
CREATE INDEX idx_packages_org_id ON public.packages(organization_id);
CREATE INDEX idx_packages_status ON public.packages(status);
CREATE INDEX idx_patients_org_id ON public.patients(organization_id);
CREATE INDEX idx_patients_phone ON public.patients(phone);
CREATE INDEX idx_bookings_org_id ON public.bookings(organization_id);
CREATE INDEX idx_bookings_patient_id ON public.bookings(patient_id);
CREATE INDEX idx_bookings_package_id ON public.bookings(package_id);
CREATE INDEX idx_bookings_status ON public.bookings(status);
CREATE INDEX idx_documents_org_id ON public.documents(organization_id);
CREATE INDEX idx_subscriptions_org_id ON public.subscriptions(organization_id);
CREATE INDEX idx_notifications_org_id ON public.notifications(organization_id);

-- 5. TRIGGERS
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_organizations BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_branches BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_users BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_packages BEFORE UPDATE ON public.packages FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_bookings BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_documents BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_subscriptions BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 6. ENABLE RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 7. RLS POLICIES (ใช้ user_metadata ตามที่ auth.ts ใช้จริง)
CREATE POLICY "Users can view their own organization" ON public.organizations
    FOR SELECT USING (id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can view their organization's branches" ON public.branches
    FOR SELECT USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can view their organization's users" ON public.users
    FOR SELECT USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can view their organization's packages" ON public.packages
    FOR SELECT USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can manage their organization's packages" ON public.packages
    FOR ALL USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can view their organization's patients" ON public.patients
    FOR SELECT USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can view their organization's bookings" ON public.bookings
    FOR SELECT USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can manage their organization's bookings" ON public.bookings
    FOR ALL USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can view their organization's documents" ON public.documents
    FOR SELECT USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can manage their organization's documents" ON public.documents
    FOR ALL USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can view their organization's subscriptions" ON public.subscriptions
    FOR SELECT USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can view their organization's notifications" ON public.notifications
    FOR SELECT USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Users can update their organization's notifications" ON public.notifications
    FOR UPDATE USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
