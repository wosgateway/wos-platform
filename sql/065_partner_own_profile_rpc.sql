-- ============================================================
-- 065_partner_own_profile_rpc.sql
--
-- Finding (STEP 1 audit, live pg_policies dump):
--   Policy "Partners can update own profile" (UPDATE on public.partners,
--   USING/CHECK: id = current_user_partner_id()) is row-scoped only.
--   CompanyProfile.tsx (partner portal) legitimately uses it to sync
--   {name, description, province, logo_url, cover_image_url} from
--   organizations -> partners -- but because column privileges in
--   Postgres are per-ROLE, not per-POLICY, we can't just REVOKE the
--   `status` column from `authenticated`: PartnersManager.tsx (admin)
--   runs as the SAME `authenticated` role and needs to edit `status`
--   (and other columns) via its own separate "Platform admins can
--   manage partners" ALL policy. Column-level GRANT/REVOKE would hit
--   both policies at once and break admin.
--
--   So instead of narrowing the policy, we remove it and move partner
--   self-service to a SECURITY DEFINER RPC that whitelists exactly the
--   columns CompanyProfile.tsx is meant to touch -- same pattern as
--   partner_update_order_item_notes (migration 035). `status` (and
--   everything else on partners) is simply not a parameter, so there is
--   no code path left, forged REST call or not, for a partner to flip
--   their own status/category/rating outside of admin action.
--
-- Deploy together with the accompanying route + CompanyProfile.tsx
-- change (same signature-change rule as migration 060): once this file
-- runs, direct `.from('partners').update(...)` from a partner session
-- returns a permissions error, so the old client code must be replaced
-- in the same deploy.
-- ============================================================

DROP FUNCTION IF EXISTS public.partner_update_own_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.partner_update_own_profile(
    p_partner_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_province TEXT,
    p_logo_url TEXT,
    p_cover_image_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row RECORD;
BEGIN
    -- p_partner_id is expected to come from the caller's own session
    -- (route resolves it via getPartnerSession()'s user.branch.partner_id,
    -- exactly like 060's partnerId resolution) -- never from client body.
    -- Function itself is service_role-only (see GRANT below), so the
    -- route is the only caller and is trusted to pass the right id.
    UPDATE public.partners
    SET name = p_name,
        description = p_description,
        province = p_province,
        logo_url = p_logo_url,
        cover_image_url = p_cover_image_url,
        updated_at = now()
    WHERE id = p_partner_id
    RETURNING * INTO v_row;

    IF v_row IS NULL THEN
        RAISE EXCEPTION 'partner_not_found';
    END IF;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'name', v_row.name,
        'description', v_row.description,
        'province', v_row.province,
        'logo_url', v_row.logo_url,
        'cover_image_url', v_row.cover_image_url
    );
END;
$$;

REVOKE ALL ON FUNCTION public.partner_update_own_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_update_own_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.partner_update_own_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.partner_update_own_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- Remove the direct-table policy this RPC replaces. The admin policy
-- ("Platform admins can manage partners", ALL, is_platform_admin())
-- is untouched and keeps working exactly as before.
DROP POLICY IF EXISTS "Partners can update own profile" ON public.partners;

-- Sanity check to run after applying, expected: 0 rows
-- (no partner-self-service UPDATE policy left on public.partners)
--
-- select policyname, roles, cmd
-- from pg_policies
-- where schemaname = 'public' and tablename = 'partners' and cmd = 'UPDATE';
