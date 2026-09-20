-- ============================================================
-- MIGRATION 074: WOS Matching Engine — Sprint 1: Taxonomy Foundation
--
-- Scope of THIS migration only: master-data ("dictionary") tables that
-- every later Sprint (Partner Intelligence, Matching Engine V1, AI
-- Intake) will reference. It does NOT touch doctors, programs,
-- services, or any junction table — those are Sprint 2/3 and belong
-- in later migration files, once these tables exist to point at.
--
-- Design decisions carried over from the WOS AI matching-architecture
-- discussion (documented outside this repo):
--   1. Every taxonomy table is multilingual from day one (name_th /
--      name_en / name_lo) — matches next-intl's th/en/lo locales
--      already used across the app.
--   2. slug is the stable machine-readable key (used by code, AI
--      intake output, and any hardcoded rules in Sprint 3). name_* is
--      what gets displayed. Never rename a slug once referenced
--      elsewhere — add a new one and deprecate the old (is_active =
--      false) instead.
--   3. health_categories is a light top-level grouping used for
--      admin UI organization and filtering, NOT a hard classification.
--      specialties / conditions / treatments / health_goals each
--      carry an optional category_id (nullable — many rows won't
--      cleanly fit one category, and that's fine at this layer).
--   4. Many-to-many relationships between these taxonomy rows and
--      partners/doctors/programs are NOT created here — they don't
--      exist yet. Sprint 2 will add junction tables such as
--      doctor_specialties, program_conditions, program_treatments,
--      program_health_goals, partner_treatments once doctors/programs
--      exist. Building those junctions now against nothing would just
--      be guessing their shape.
--   5. matchable_entity_types is a closed lookup table answering
--      "what can the matching engine recommend a customer?" — decided
--      now on purpose, before Sprint 3 needs it, so later tables like
--      a future match_results (entity_type, entity_id) can validate
--      entity_type against a real FK instead of a scattered CHECK
--      constraint repeated in multiple places.
--
-- Purely additive — does not touch partners, packages, orders, or any
-- existing table. Idempotent (IF NOT EXISTS / DROP+ADD throughout),
-- matching the pattern used in 045/046/047.
-- ============================================================


-- ------------------------------------------------------------
-- 1) health_categories — top-level grouping (e.g. "Neurology",
--    "Aesthetic Surgery", "Wellness & Anti-aging"). Self-referencing
--    parent_id allows a shallow subcategory later if ever needed, but
--    is expected to stay NULL (flat list) for a long time — don't
--    build UI that assumes deep nesting.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.health_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL,
    name_th TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_lo TEXT NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES public.health_categories(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.health_categories DROP CONSTRAINT IF EXISTS health_categories_slug_unique;
ALTER TABLE public.health_categories ADD CONSTRAINT health_categories_slug_unique UNIQUE (slug);

-- A category can't be its own parent (trivial cycle). Deeper cycles
-- (A -> B -> A) are not blocked at the DB level — acceptable at this
-- table's expected size (dozens of rows, admin-curated, not
-- user-generated), but worth remembering if this table ever grows.
ALTER TABLE public.health_categories DROP CONSTRAINT IF EXISTS health_categories_no_self_parent;
ALTER TABLE public.health_categories ADD CONSTRAINT health_categories_no_self_parent
    CHECK (parent_id IS NULL OR parent_id <> id);

CREATE INDEX IF NOT EXISTS idx_health_categories_parent ON public.health_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_health_categories_active ON public.health_categories(is_active);


-- ------------------------------------------------------------
-- 2) specialties — medical/wellness specialties (e.g. "Neurology",
--    "Plastic Surgery", "Rhinoplasty" as a sub-specialty via parent_id).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.specialties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL,
    name_th TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_lo TEXT NOT NULL,
    description TEXT,
    category_id UUID REFERENCES public.health_categories(id) ON DELETE SET NULL,
    parent_id UUID REFERENCES public.specialties(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.specialties DROP CONSTRAINT IF EXISTS specialties_slug_unique;
ALTER TABLE public.specialties ADD CONSTRAINT specialties_slug_unique UNIQUE (slug);

ALTER TABLE public.specialties DROP CONSTRAINT IF EXISTS specialties_no_self_parent;
ALTER TABLE public.specialties ADD CONSTRAINT specialties_no_self_parent
    CHECK (parent_id IS NULL OR parent_id <> id);

CREATE INDEX IF NOT EXISTS idx_specialties_category ON public.specialties(category_id);
CREATE INDEX IF NOT EXISTS idx_specialties_parent ON public.specialties(parent_id);
CREATE INDEX IF NOT EXISTS idx_specialties_active ON public.specialties(is_active);


-- ------------------------------------------------------------
-- 3) conditions — what the customer has / is seeking treatment for
--    (e.g. "Migraine", "Chronic Rhinitis"). This is patient-facing
--    vocabulary, deliberately kept separate from `specialties`
--    (provider-facing vocabulary) — a condition maps to one or more
--    specialties via a Sprint-2/3 junction table, not a direct column,
--    because that mapping is itself a business decision the matching
--    engine needs to reason about, not a fixed 1:1 fact.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conditions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL,
    name_th TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_lo TEXT NOT NULL,
    description TEXT,
    category_id UUID REFERENCES public.health_categories(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.conditions DROP CONSTRAINT IF EXISTS conditions_slug_unique;
ALTER TABLE public.conditions ADD CONSTRAINT conditions_slug_unique UNIQUE (slug);

CREATE INDEX IF NOT EXISTS idx_conditions_category ON public.conditions(category_id);
CREATE INDEX IF NOT EXISTS idx_conditions_active ON public.conditions(is_active);


-- ------------------------------------------------------------
-- 4) treatments — the actual procedure/service/program type (e.g.
--    "Rhinoplasty", "Revision Rhinoplasty", "Migraine Management
--    Program"). This is what eventually gets linked to a partner's
--    program/package in Sprint 2.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.treatments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL,
    name_th TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_lo TEXT NOT NULL,
    description TEXT,
    category_id UUID REFERENCES public.health_categories(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.treatments DROP CONSTRAINT IF EXISTS treatments_slug_unique;
ALTER TABLE public.treatments ADD CONSTRAINT treatments_slug_unique UNIQUE (slug);

CREATE INDEX IF NOT EXISTS idx_treatments_category ON public.treatments(category_id);
CREATE INDEX IF NOT EXISTS idx_treatments_active ON public.treatments(is_active);


-- ------------------------------------------------------------
-- 5) health_goals — the customer's outcome/intent, distinct from a
--    diagnosed condition (e.g. "Natural-looking result", "Pain
--    relief", "General health check-up"). Needed separately from
--    `conditions` because a customer often states a goal without a
--    condition ("อยากทำจมูกแบบธรรมชาติ" has no medical condition
--    attached at all) and AI Intake (Sprint 4) needs a slot for that.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.health_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL,
    name_th TEXT NOT NULL,
    name_en TEXT NOT NULL,
    name_lo TEXT NOT NULL,
    description TEXT,
    category_id UUID REFERENCES public.health_categories(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.health_goals DROP CONSTRAINT IF EXISTS health_goals_slug_unique;
ALTER TABLE public.health_goals ADD CONSTRAINT health_goals_slug_unique UNIQUE (slug);

CREATE INDEX IF NOT EXISTS idx_health_goals_category ON public.health_goals(category_id);
CREATE INDEX IF NOT EXISTS idx_health_goals_active ON public.health_goals(is_active);


-- ------------------------------------------------------------
-- 6) matchable_entity_types — closed lookup answering "what is the
--    matching engine allowed to recommend a customer?" Decided now,
--    before Sprint 3 exists, per the architecture discussion. Kept as
--    a real table (not a CHECK-constraint enum) so it can be extended
--    without a migration touching every table that references it, and
--    so a future match_results table can FK against it directly.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matchable_entity_types (
    code TEXT PRIMARY KEY,
    label_th TEXT NOT NULL,
    label_en TEXT NOT NULL,
    label_lo TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO public.matchable_entity_types (code, label_th, label_en, label_lo) VALUES
    ('partner',  'พาร์ทเนอร์', 'Partner',  'ຄູ່ຮ່ວມງານ'),
    ('doctor',   'แพทย์',       'Doctor',   'ທ່ານໝໍ'),
    ('program',  'โปรแกรม',    'Program',  'ໂຄງການ'),
    ('treatment','การรักษา',   'Treatment','ການປິ່ນປົວ'),
    ('package',  'แพ็กเกจ',    'Package',  'ແພັກເກັດ')
ON CONFLICT (code) DO NOTHING;

-- Intentionally no RLS on this table: 5 static rows, no PII, no
-- business-sensitive content, read everywhere (public site, admin,
-- matching engine, AI intake). Enabling RLS here would only add a
-- policy to maintain with zero actual protection benefit.


-- ------------------------------------------------------------
-- updated_at triggers — reuse public.handle_updated_at(), already
-- defined in 001_schema_and_rls.sql. Not redefined here.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_health_categories ON public.health_categories;
CREATE TRIGGER set_updated_at_health_categories BEFORE UPDATE ON public.health_categories
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_specialties ON public.specialties;
CREATE TRIGGER set_updated_at_specialties BEFORE UPDATE ON public.specialties
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_conditions ON public.conditions;
CREATE TRIGGER set_updated_at_conditions BEFORE UPDATE ON public.conditions
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_treatments ON public.treatments;
CREATE TRIGGER set_updated_at_treatments BEFORE UPDATE ON public.treatments
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_health_goals ON public.health_goals;
CREATE TRIGGER set_updated_at_health_goals BEFORE UPDATE ON public.health_goals
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ------------------------------------------------------------
-- RLS — same pattern as 046 (transit_points): public can read active
-- rows, only admin/service_role can write. These tables will be read
-- from the public site (program/partner detail pages showing
-- specialty/condition tags), the matching engine, and AI intake — all
-- of which should only ever see is_active = true rows.
-- ------------------------------------------------------------
ALTER TABLE public.health_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active health categories" ON public.health_categories;
CREATE POLICY "Public can read active health categories" ON public.health_categories
    FOR SELECT TO anon, authenticated USING (is_active = true);

DROP POLICY IF EXISTS "Public can read active specialties" ON public.specialties;
CREATE POLICY "Public can read active specialties" ON public.specialties
    FOR SELECT TO anon, authenticated USING (is_active = true);

DROP POLICY IF EXISTS "Public can read active conditions" ON public.conditions;
CREATE POLICY "Public can read active conditions" ON public.conditions
    FOR SELECT TO anon, authenticated USING (is_active = true);

DROP POLICY IF EXISTS "Public can read active treatments" ON public.treatments;
CREATE POLICY "Public can read active treatments" ON public.treatments
    FOR SELECT TO anon, authenticated USING (is_active = true);

DROP POLICY IF EXISTS "Public can read active health goals" ON public.health_goals;
CREATE POLICY "Public can read active health goals" ON public.health_goals
    FOR SELECT TO anon, authenticated USING (is_active = true);

-- No anon/authenticated write policy on purpose — admin-managed only,
-- via service_role (same reasoning as 046). If the admin UI ends up
-- writing through the browser Supabase client instead of an API
-- route, add an authenticated-role policy scoped to an is-admin check
-- here instead of leaving these service_role-only.


-- ============================================================
-- Seed data — a HANDFUL of illustrative rows only, so the schema is
-- testable end-to-end and Sprint 2/3 have something real to link
-- against during development. This is NOT the real taxonomy — content
-- ownership (the actual list of specialties/conditions/treatments WOS
-- supports) is a domain decision for the WOS team, not something to
-- invent wholesale in a migration file. Review/replace before this
-- reaches production.
-- ============================================================
INSERT INTO public.health_categories (slug, name_th, name_en, name_lo, sort_order) VALUES
    ('neurology',          'ประสาทวิทยา',       'Neurology',          'ປະສາດວິທະຍາ',       10),
    ('aesthetic-surgery',  'ศัลยกรรมความงาม',  'Aesthetic Surgery',  'ການຜ່າຕັດຄວາມງາມ',  20),
    ('wellness-antiaging', 'เวลเนสและชะลอวัย', 'Wellness & Anti-aging', 'ສຸຂະພາບແລະຊະລໍວັຍ', 30)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.specialties (slug, name_th, name_en, name_lo, category_id) VALUES
    ('neurology', 'ประสาทวิทยา', 'Neurology', 'ປະສາດວິທະຍາ',
        (SELECT id FROM public.health_categories WHERE slug = 'neurology')),
    ('plastic-surgery', 'ศัลยกรรมตกแต่ง', 'Plastic Surgery', 'ການຜ່າຕັດຕົກແຕ່ງ',
        (SELECT id FROM public.health_categories WHERE slug = 'aesthetic-surgery'))
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.conditions (slug, name_th, name_en, name_lo, category_id) VALUES
    ('migraine', 'ไมเกรน', 'Migraine', 'ໄມແກຣນ',
        (SELECT id FROM public.health_categories WHERE slug = 'neurology'))
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.treatments (slug, name_th, name_en, name_lo, category_id) VALUES
    ('rhinoplasty', 'ศัลยกรรมจมูก', 'Rhinoplasty', 'ການຜ່າຕັດດັງ',
        (SELECT id FROM public.health_categories WHERE slug = 'aesthetic-surgery')),
    ('migraine-management', 'โปรแกรมจัดการไมเกรน', 'Migraine Management Program', 'ໂຄງການຄຸ້ມຄອງໄມແກຣນ',
        (SELECT id FROM public.health_categories WHERE slug = 'neurology'))
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.health_goals (slug, name_th, name_en, name_lo, category_id) VALUES
    ('natural-result', 'ผลลัพธ์ที่ดูเป็นธรรมชาติ', 'Natural-looking result', 'ຜົນທີ່ເປັນທຳມະຊາດ',
        (SELECT id FROM public.health_categories WHERE slug = 'aesthetic-surgery')),
    ('pain-relief', 'บรรเทาอาการปวด', 'Pain relief', 'ບັນເທົາອາການເຈັບ',
        (SELECT id FROM public.health_categories WHERE slug = 'neurology'))
ON CONFLICT (slug) DO NOTHING;


-- ============================================================
-- QA — run after applying on staging, before moving to Sprint 2
-- ============================================================

-- Expected: all 6 tables exist, RLS enabled on the 5 that have it
-- (matchable_entity_types intentionally shows relrowsecurity = false)
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('health_categories', 'specialties', 'conditions',
                   'treatments', 'health_goals', 'matchable_entity_types');

-- Expected: exactly one SELECT policy per RLS-enabled table, all
-- restricted to is_active = true
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('health_categories', 'specialties', 'conditions',
                     'treatments', 'health_goals')
ORDER BY tablename;

-- Expected: 5 rows (partner/doctor/program/treatment/package)
SELECT code, label_en FROM public.matchable_entity_types ORDER BY code;

-- Expected: no orphaned category_id / parent_id references (all FKs
-- resolve or are NULL)
SELECT 'specialties' AS tbl, count(*) FROM public.specialties s
    WHERE s.category_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.health_categories c WHERE c.id = s.category_id)
UNION ALL
SELECT 'conditions', count(*) FROM public.conditions co
    WHERE co.category_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.health_categories c WHERE c.id = co.category_id)
UNION ALL
SELECT 'treatments', count(*) FROM public.treatments t
    WHERE t.category_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.health_categories c WHERE c.id = t.category_id)
UNION ALL
SELECT 'health_goals', count(*) FROM public.health_goals hg
    WHERE hg.category_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.health_categories c WHERE c.id = hg.category_id);

-- Expected: no duplicate slugs within any single table (UNIQUE
-- constraint should already guarantee this — sanity check only)
SELECT 'specialties' AS tbl, slug, count(*) FROM public.specialties GROUP BY slug HAVING count(*) > 1
UNION ALL
SELECT 'conditions', slug, count(*) FROM public.conditions GROUP BY slug HAVING count(*) > 1
UNION ALL
SELECT 'treatments', slug, count(*) FROM public.treatments GROUP BY slug HAVING count(*) > 1
UNION ALL
SELECT 'health_goals', slug, count(*) FROM public.health_goals GROUP BY slug HAVING count(*) > 1;

-- Smoke test as anon would see it via PostgREST/RLS — run with the
-- anon key in Supabase's SQL editor "Run as" / API tester, not as
-- postgres superuser (superuser bypasses RLS regardless of policy).
-- SELECT * FROM public.conditions; -- as anon: should show only is_active = true rows
