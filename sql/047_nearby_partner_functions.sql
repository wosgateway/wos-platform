-- ============================================================
-- MIGRATION 047: nearby partner/transit-point RPC functions
-- (Medical Logistics Map, part 3/3)
--
-- These two functions are called DIRECTLY from the public frontend
-- via `supabase.rpc(...)` using the anon key — no Next.js API route in
-- between. Everything here is written with that threat model in mind:
-- an anonymous, unauthenticated visitor is the caller.
--
-- Security decisions (deliberately explicit, not left to defaults):
--
-- 1. SECURITY INVOKER (the default — not specifying SECURITY DEFINER
--    at all). The function runs with the CALLER's privileges, so
--    Postgres RLS on `partners` / `transit_points` still applies on
--    top of the explicit WHERE filters below. This is strictly safer
--    than SECURITY DEFINER here: there is no reason for this read-only
--    lookup to run with elevated rights, and using DEFINER would mean
--    a bug in the WHERE clause could leak rows RLS would otherwise
--    have blocked.
--
-- 2. `SET search_path = public, pg_temp` pinned explicitly on both
--    functions. Without this, a SECURITY DEFINER function is the
--    classic search_path-hijack vector — not applicable here since
--    these are INVOKER, but pinning search_path costs nothing and
--    keeps the pattern consistent/safe if anyone ever changes these to
--    DEFINER later without re-reading this comment.
--
-- 3. Radius is clamped server-side to a 25km ceiling regardless of
--    what the caller passes in. Prevents `radius_meters=50000000` from
--    turning this into an unbounded full-table geo-scan.
--
-- 4. Result count is clamped too (default 3, hard max 20) — same
--    reasoning, prevents an attacker from requesting the entire
--    partners table back through a "nearby" call with a huge limit.
--
-- 5. Every business-rule filter from earlier review rounds is applied
--    explicitly rather than trusted to RLS alone:
--      partners.status = 'active'            (not 'published' — see 045)
--      partners.location_status = 'verified' (pending/rejected excluded)
--      partners.category = 'Hotel'
--      geom IS NOT NULL
--    Applied to BOTH the origin partner (p1 / p) and the result rows
--    (p2 / tp) — not just one side. A verified-but-later-deactivated
--    partner will correctly stop appearing either as an origin (no
--    results returned for it) or as a result (excluded from other
--    partners' nearby lists) without needing any change here.
--
-- 6. EXECUTE is granted explicitly to anon + authenticated. This
--    project's default privileges (027) already auto-grant EXECUTE on
--    new functions, but granting explicitly here means this file is
--    correct on its own even if that project-wide default is ever
--    changed later.
-- ============================================================

-- ------------------------------------------------------------
-- nearby_partners: hotels near a given (already-verified) partner
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nearby_partners(
    p_partner_id UUID,
    p_radius_meters INTEGER DEFAULT 5000,
    p_limit INTEGER DEFAULT 3
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    category TEXT,
    distance_meters DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        p2.id,
        p2.name,
        p2.category,
        ST_Distance(p1.geom, p2.geom) AS distance_meters
    FROM public.partners p1
    JOIN public.partners p2
        ON p2.id <> p1.id
    WHERE p1.id = p_partner_id
      AND p1.status = 'active'
      AND p1.geom IS NOT NULL
      AND p1.location_status = 'verified'
      AND p2.geom IS NOT NULL
      AND p2.location_status = 'verified'
      AND p2.status = 'active'
      AND p2.category = 'Hotel'
      AND ST_DWithin(p1.geom, p2.geom, LEAST(GREATEST(p_radius_meters, 0), 25000))
    ORDER BY distance_meters ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 20);
$$;

REVOKE ALL ON FUNCTION public.nearby_partners(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nearby_partners(UUID, INTEGER, INTEGER) TO anon, authenticated;

-- ------------------------------------------------------------
-- nearby_transit_points: borders/airports near a given verified partner
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nearby_transit_points(
    p_partner_id UUID,
    p_radius_meters INTEGER DEFAULT 25000,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    name_th TEXT,
    name_en TEXT,
    name_lo TEXT,
    type TEXT,
    distance_meters DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        tp.id,
        tp.name_th,
        tp.name_en,
        tp.name_lo,
        tp.type,
        ST_Distance(p.geom, tp.geom) AS distance_meters
    FROM public.partners p
    JOIN public.transit_points tp
        ON tp.active = true
    WHERE p.id = p_partner_id
      AND p.status = 'active'
      AND p.geom IS NOT NULL
      AND p.location_status = 'verified'
      AND ST_DWithin(p.geom, tp.geom, LEAST(GREATEST(p_radius_meters, 0), 25000))
    ORDER BY distance_meters ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 20);
$$;

REVOKE ALL ON FUNCTION public.nearby_transit_points(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nearby_transit_points(UUID, INTEGER, INTEGER) TO anon, authenticated;

-- ============================================================
-- QA — run after applying, before wiring up the frontend
-- ============================================================

-- (a) Confirm both functions exist and are INVOKER (not DEFINER) —
-- prosecdef should be `false` for both.
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE proname IN ('nearby_partners', 'nearby_transit_points')
  AND pronamespace = 'public'::regnamespace;

-- (b) Confirm EXECUTE grants landed for anon/authenticated
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name IN ('nearby_partners', 'nearby_transit_points')
  AND grantee IN ('anon', 'authenticated');

-- (c) Radius clamp actually clamps — pass an absurd radius, confirm
-- this doesn't scan/return more than a real 25km call would.
--
-- IMPORTANT trade-off introduced by this file's p1.status = 'active'
-- fix: the origin partner passed as p_partner_id must now be
-- status='active' AND location_status='verified' for either function
-- to return anything at all. That means a disposable ZZZ_QA_TEST_*
-- partner used to exercise this RPC will be genuinely visible on the
-- public site (fetchPartnerById filters on status='active' too) for
-- as long as it exists — unlike the 045 trigger test, where
-- status='inactive' kept the test row hidden throughout. Keep the
-- test window as short as possible: insert, run the calls below
-- immediately, then delete right away. Do not leave a ZZZ_QA_TEST_*
-- partner sitting at status='active' for longer than the test takes.

-- Example once you have such a test partner id (active + verified):
-- SELECT * FROM public.nearby_partners('<test_partner_id>', 999999999, 3);
-- SELECT * FROM public.nearby_partners('<test_partner_id>', 5000, 999);
-- Second call should still return at most 20 rows regardless of the
-- p_limit value passed.

-- (d) End-to-end smoke test AS ANON (not superuser) once you have at
-- least one verified partner with geom + at least one nearby Hotel
-- partner with geom in production:
-- SET ROLE anon;
-- SELECT * FROM public.nearby_partners('<real_partner_id>', 5000, 3);
-- SELECT * FROM public.nearby_transit_points('<real_partner_id>', 25000, 5);
-- RESET ROLE;
-- Both should return rows (or empty, if nothing is verified/nearby
-- yet) without an ERROR about insufficient privilege — a privilege
-- error here means the GRANT EXECUTE above didn't take effect.
