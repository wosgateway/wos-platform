-- ============================================================
-- 070_harden_partner_profile_ownership.sql
--
-- Follow-up hardening for 065_partner_own_profile_rpc.sql.
--
-- Finding (second-pass review, "attacker mindset" pass on 060-069):
--   partner_update_own_profile(p_partner_id, ...) trusts p_partner_id
--   as given -- it never independently verifies that p_partner_id
--   actually belongs to whoever is calling. Today that's safe because
--   the ONLY caller is PATCH /api/partner/profile, which derives
--   p_partner_id from getPartnerSession().user.branch.partner_id
--   server-side and never from client input (verified against the
--   live route). But the RPC itself has no ownership check of its
--   own -- SECURITY DEFINER + service_role-only EXECUTE closes the
--   direct-client path, not a future server-side caller that passes
--   the wrong id (bug, new admin tool, copy-pasted code, etc).
--
--   This is architecturally the same class of gap 060 already closed
--   for partner_verify_payment: that RPC doesn't just trust
--   p_partner_id either -- it cross-checks it against
--   order_items.partner_id, a second, independently-stored fact,
--   inside the same transaction. This migration gives
--   partner_update_own_profile the equivalent check.
--
-- Why NOT current_user_partner_id():
--   That helper reads auth.uid(), which requires a user JWT on the
--   request. This RPC is called through the SERVICE-ROLE client (see
--   065's comment -- the route already established that pattern), so
--   there is no session for auth.uid() to read; current_user_partner_id()
--   would simply return NULL here and any IS DISTINCT FROM check
--   against it would always fail. Instead, this migration adds an
--   explicit p_calling_user_id parameter (the route already has this
--   -- it's user.id from getPartnerSession(), the same field already
--   passed as p_verified_by_user_id in 060's verify route) and looks
--   up that user's branch -> partner_id inside the function, using
--   the identical join current_user_partner_id() uses internally
--   (007_consolidate_group_b_rls_and_fk_fixes.sql), just keyed off an
--   explicit id instead of auth.uid().
--
-- Deploy together with the accompanying route change (same
-- signature-change rule as 060/065): once this runs, the old
-- 6-argument function no longer exists, so
-- src/app/api/partner/profile/route.ts must pass p_calling_user_id
-- in the same deploy or every profile update will 500.
-- ============================================================

DROP FUNCTION IF EXISTS public.partner_update_own_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);

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
    -- Independent ownership check: derive the calling user's partner_id
    -- from the DB itself (same join as current_user_partner_id()),
    -- rather than trusting p_partner_id as given. This is the RPC-level
    -- boundary the route-level check in 065 was missing -- if a future
    -- caller (bug or otherwise) passes a p_partner_id that doesn't
    -- belong to p_calling_user_id, this rejects before any write.
    SELECT b.partner_id
    INTO v_caller_partner_id
    FROM public.users u
    JOIN public.branches b ON b.id = u.branch_id
    WHERE u.id = p_calling_user_id
    LIMIT 1;

    IF v_caller_partner_id IS NULL OR v_caller_partner_id IS DISTINCT FROM p_partner_id THEN
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

REVOKE ALL ON FUNCTION public.partner_update_own_profile(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_update_own_profile(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.partner_update_own_profile(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.partner_update_own_profile(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- Sanity check to run after applying, expected: 1 row, matching the
-- new 7-arg signature (old 6-arg one should be gone entirely --
-- DROP FUNCTION above removes it, this just confirms):
--
-- select proname, pronargs
-- from pg_proc
-- where proname = 'partner_update_own_profile';
