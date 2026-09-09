-- ============================================================
-- MIGRATION 091: WOS Matching Engine — Sprint 2: Doctors + Programs
--
-- Scope: creates the two entities 074 deliberately left out
-- (doctors, programs), plus the junction tables 074's comments
-- already named as Sprint 2 work: doctor_specialties,
-- program_conditions, program_treatments, program_health_goals,
-- partner_treatments. Also adds program_doctors, which 074 didn't
-- name explicitly but is required once both tables exist (a program
-- needs to say which doctor(s) run it).
--
-- DESIGN DECISION — programs vs packages (confirmed with WOS,
-- 2026-09-09): `programs` is a NEW, separate table. It is NOT a
-- rename or extension of `packages`.
--   - `packages` keeps doing exactly what it does today: the
--     bookable, priced, partner-owned catalog item (title, price,
--     status draft/published, is_active) — untouched by this
--     migration, same as 074 left it untouched.
--   - `programs` is content-layer only: which doctor(s) run a named
--     treatment program, and which conditions/treatments/health_goals
--     it addresses. It has NO price, NO booking flow, and NO direct
--     FK to `packages` in this migration on purpose — the matching
--     engine (Sprint 3) is expected to connect a customer to relevant
--     `packages` via shared taxonomy tags (conditions/treatments/
--     health_goals), not via a hardcoded program->package link. If a
--     direct link turns out to be needed later, add a nullable
--     `programs.package_id` or a `program_packages` junction then —
--     don't guess it now.
--
-- Purely additive — does not touch partners, packages, orders, or any
-- existing table. Idempotent (IF NOT EXISTS / DROP+ADD throughout),
-- matching the pattern used in 074/045/046.
-- ============================================================


-- ------------------------------------------------------------
-- 1) doctors — a doctor practices at exactly one partner (Hospital/
--    Clinic/Wellness/etc). No multi-partner support here; if a real
--    doctor practices at two partner locations, model that as two
--    rows for now rather than guessing a many-to-many shape nobody
--    has asked for yet.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    title TEXT,
    photo_url TEXT,
    bio_th TEXT,
    bio_en TEXT,
    bio_lo TEXT,
    years_experience INTEGER,
    languages_spoken TEXT[] NOT NULL DEFAULT '{}'::text[],
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.doctors DROP CONSTRAINT IF EXISTS doctors_status_check;
ALTER TABLE public.doctors ADD CONSTRAINT doctors_status_check
    CHECK (status = ANY (ARRAY['active', 'inactive']));

CREATE INDEX IF NOT EXISTS idx_doctors_partner ON public.doctors(partner_id);
CREATE INDEX IF NOT EXISTS idx_doctors_status ON public.doctors(status);


-- ------------------------------------------------------------
-- 2) programs — partner-authored content describing a named
--    treatment program (e.g. "Migraine Management Program"). Single-
--    language fields (title/description), matching `packages`'
--    existing convention — this is partner-entered content, not
--    admin-curated master taxonomy, so it does not get the
--    name_th/name_en/name_lo treatment 074's tables use.
--    status/is_active mirror `packages` exactly (see 053) so the
--    same draft-vs-published + soft-disable pattern applies.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    short_description TEXT,
    description TEXT,
    image_url TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_status_check;
ALTER TABLE public.programs ADD CONSTRAINT programs_status_check
    CHECK (status = ANY (ARRAY['draft', 'published']));

CREATE INDEX IF NOT EXISTS idx_programs_partner ON public.programs(partner_id);
CREATE INDEX IF NOT EXISTS idx_programs_status ON public.programs(status);
CREATE INDEX IF NOT EXISTS idx_programs_active ON public.programs(is_active);


-- ------------------------------------------------------------
-- 3) Junction tables — plain composite-PK many-to-many, no surrogate
--    id, no extra metadata columns (matches how this schema keeps
--    junctions elsewhere: minimal, ON DELETE CASCADE both directions
--    since a link row has no meaning once either side is gone).
-- ------------------------------------------------------------

-- doctor <-> specialties (074 taxonomy)
CREATE TABLE IF NOT EXISTS public.doctor_specialties (
    doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    specialty_id UUID NOT NULL REFERENCES public.specialties(id) ON DELETE CASCADE,
    PRIMARY KEY (doctor_id, specialty_id)
);
CREATE INDEX IF NOT EXISTS idx_doctor_specialties_specialty ON public.doctor_specialties(specialty_id);

-- program <-> doctors (who runs this program)
CREATE TABLE IF NOT EXISTS public.program_doctors (
    program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    PRIMARY KEY (program_id, doctor_id)
);
CREATE INDEX IF NOT EXISTS idx_program_doctors_doctor ON public.program_doctors(doctor_id);

-- program <-> conditions (074 taxonomy — what this program treats)
CREATE TABLE IF NOT EXISTS public.program_conditions (
    program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
    condition_id UUID NOT NULL REFERENCES public.conditions(id) ON DELETE CASCADE,
    PRIMARY KEY (program_id, condition_id)
);
CREATE INDEX IF NOT EXISTS idx_program_conditions_condition ON public.program_conditions(condition_id);

-- program <-> treatments (074 taxonomy — what this program consists of)
CREATE TABLE IF NOT EXISTS public.program_treatments (
    program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
    treatment_id UUID NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
    PRIMARY KEY (program_id, treatment_id)
);
CREATE INDEX IF NOT EXISTS idx_program_treatments_treatment ON public.program_treatments(treatment_id);

-- program <-> health_goals (074 taxonomy — what outcome this program serves)
CREATE TABLE IF NOT EXISTS public.program_health_goals (
    program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
    health_goal_id UUID NOT NULL REFERENCES public.health_goals(id) ON DELETE CASCADE,
    PRIMARY KEY (program_id, health_goal_id)
);
CREATE INDEX IF NOT EXISTS idx_program_health_goals_goal ON public.program_health_goals(health_goal_id);

-- partner <-> treatments (partner-level capability, independent of any
-- specific program — "does this partner offer rhinoplasty at all")
CREATE TABLE IF NOT EXISTS public.partner_treatments (
    partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
    treatment_id UUID NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
    PRIMARY KEY (partner_id, treatment_id)
);
CREATE INDEX IF NOT EXISTS idx_partner_treatments_treatment ON public.partner_treatments(treatment_id);


-- ------------------------------------------------------------
-- updated_at triggers — reuse public.handle_updated_at(), already
-- defined in 001_schema_and_rls.sql. Junction tables have no
-- updated_at column (link rows aren't edited, only created/deleted),
-- matching the shape of every other junction table in this schema.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_doctors ON public.doctors;
CREATE TRIGGER set_updated_at_doctors BEFORE UPDATE ON public.doctors
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_programs ON public.programs;
CREATE TRIGGER set_updated_at_programs BEFORE UPDATE ON public.programs
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ------------------------------------------------------------
-- RLS — same pattern as 074/046/053: public reads only what's
-- publicly visible, no anon/authenticated write policy anywhere
-- (admin writes go through service_role via the API layer's
-- requireAdmin gate, same as every other admin-managed table here).
-- ------------------------------------------------------------
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_health_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_treatments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active doctors" ON public.doctors;
CREATE POLICY "Public can read active doctors" ON public.doctors
    FOR SELECT TO anon, authenticated USING (status = 'active');

DROP POLICY IF EXISTS "Public can read published programs" ON public.programs;
CREATE POLICY "Public can read published programs" ON public.programs
    FOR SELECT TO anon, authenticated USING (status = 'published' AND is_active = true);

-- Junction tables carry no PII and no price/business-sensitive data —
-- readable to everyone, same reasoning 074 used for
-- matchable_entity_types. The app layer is responsible for not
-- surfacing a link row whose doctor/program parent isn't itself
-- public (RLS here does not join back to check parent status).
DROP POLICY IF EXISTS "Public can read doctor_specialties" ON public.doctor_specialties;
CREATE POLICY "Public can read doctor_specialties" ON public.doctor_specialties
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read program_doctors" ON public.program_doctors;
CREATE POLICY "Public can read program_doctors" ON public.program_doctors
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read program_conditions" ON public.program_conditions;
CREATE POLICY "Public can read program_conditions" ON public.program_conditions
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read program_treatments" ON public.program_treatments;
CREATE POLICY "Public can read program_treatments" ON public.program_treatments
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read program_health_goals" ON public.program_health_goals;
CREATE POLICY "Public can read program_health_goals" ON public.program_health_goals
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read partner_treatments" ON public.partner_treatments;
CREATE POLICY "Public can read partner_treatments" ON public.partner_treatments
    FOR SELECT TO anon, authenticated USING (true);


-- ============================================================
-- QA — run after applying on staging
-- ============================================================

-- Expected: 8 tables exist, RLS enabled on all
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('doctors', 'programs', 'doctor_specialties',
                   'program_doctors', 'program_conditions',
                   'program_treatments', 'program_health_goals',
                   'partner_treatments');

-- Expected: exactly one SELECT policy per table listed above
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('doctors', 'programs', 'doctor_specialties',
                     'program_doctors', 'program_conditions',
                     'program_treatments', 'program_health_goals',
                     'partner_treatments')
ORDER BY tablename;

-- Expected: no rows (every doctor/program points at a real partner)
SELECT 'doctors' AS tbl, count(*) FROM public.doctors d
    WHERE NOT EXISTS (SELECT 1 FROM public.partners p WHERE p.id = d.partner_id)
UNION ALL
SELECT 'programs', count(*) FROM public.programs pr
    WHERE NOT EXISTS (SELECT 1 FROM public.partners p WHERE p.id = pr.partner_id);

-- Smoke test as anon would see it via PostgREST/RLS — run with the
-- anon key in Supabase's SQL editor "Run as" / API tester, not as
-- postgres superuser (superuser bypasses RLS regardless of policy).
-- SELECT * FROM public.doctors;  -- as anon: only status = 'active' rows
-- SELECT * FROM public.programs; -- as anon: only status='published' AND is_active=true rows
