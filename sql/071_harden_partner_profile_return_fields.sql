-- ============================================================
-- 071_harden_partner_profile_return_fields.sql
--
-- Hardening follow-up for migration 070.
--
-- Migration 070 already added RPC-level ownership verification.
-- This migration only removes unnecessary RETURNING * usage from
-- the SECURITY DEFINER function to avoid returning future columns
-- accidentally if the partners table schema changes later.
--
-- No authorization logic changes.
-- No function signature changes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.partner_update_own_profile(
    p_partner_id UUID,
    p_calling_user_id UUID,
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
    v_caller_partner_id UUID;
BEGIN
    -- Verify caller ownership at database level.
    SELECT b.partner_id
    INTO v_caller_partner_id
    FROM public.users u
    JOIN public.branches b ON b.id = u.branch_id
    WHERE u.id = p_calling_user_id
    LIMIT 1;

    IF v_caller_partner_id IS NULL
       OR v_caller_partner_id IS DISTINCT FROM p_partner_id THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;

    UPDATE public.partners
    SET name = p_name,
        description = p_description,
        province = p_province,
        logo_url = p_logo_url,
        cover_image_url = p_cover_image_url,
        updated_at = now()
    WHERE id = p_partner_id
    RETURNING
        id,
        name,
        description,
        province,
        logo_url,
        cover_image_url
    INTO v_row;

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

REVOKE ALL ON FUNCTION public.partner_update_own_profile(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.partner_update_own_profile(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

-- Verify after running:
--
-- SELECT pg_get_functiondef(oid)
-- FROM pg_proc
-- WHERE proname = 'partner_update_own_profile';
--
-- Expected:
-- RETURNING
--     id,
--     name,
--     description,
--     province,
--     logo_url,
--     cover_image_url