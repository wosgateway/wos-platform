-- 124_close_public_partner_application_insert.sql
-- Partner applications must enter through the server-side /api/partner/apply route.
-- The route uses service_role, so public browser sessions do not need INSERT access.

BEGIN;

ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public insert on partner_applications" ON public.partner_applications;

REVOKE INSERT ON public.partner_applications FROM anon, authenticated;

DROP POLICY IF EXISTS "Platform admins can manage partner_applications" ON public.partner_applications;
CREATE POLICY "Platform admins can manage partner_applications" ON public.partner_applications
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

COMMIT;
