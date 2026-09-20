-- ============================================================================
-- 099_mou_sign_requests.sql
--
-- E-signature workflow for the WOS Founding Partner MOU (Partner Portal,
-- no download/print required). Three new tables, deliberately NOT reusing
-- public.documents (001_schema_and_rls.sql) — that table is partner-
-- uploaded license/certificate files (name, file_url, category, expiry)
-- and has none of the fields a legally-defensible signature record needs
-- (signer IP, verification method, OTP timestamp, document hash). Mixing
-- the two would also mean every DocumentsManager.tsx list query has to
-- filter out signature rows, and vice versa.
--
--   mou_sign_requests  — one row per "we sent this partner a link to
--                         sign". Token-based access (same hash+timing-safe-
--                         compare pattern as trip_partner_links, see
--                         088_trip_partner_links.sql /
--                         resolvePartnerTripToken()) because the signer is
--                         very often NOT a Partner Portal user yet — the
--                         whole point of a Founding Partner MOU is
--                         onboarding a brand-new partner, so gating the
--                         signing page behind a portal login would be
--                         backwards.
--   mou_otp_codes      — short-lived OTP codes for the signing step.
--                         Hashed at rest (same reason passwords are
--                         hashed, not encrypted) — this table is
--                         disposable, so no append-only trigger.
--   mou_signatures      — APPEND-ONLY record of a completed signature.
--                         This is the actual audit trail the พ.ร.บ.
--                         ธุรกรรมทางอิเล็กทรอนิกส์ compliance requirement
--                         cares about, so it follows the exact
--                         insert-only-forever pattern audit_log already
--                         established in 073_audit_log.sql: RLS with no
--                         UPDATE/DELETE policy for anyone, PLUS a
--                         trigger that blocks UPDATE/DELETE even for
--                         service_role, because service_role bypasses RLS
--                         entirely. See 073's comment block for the full
--                         reasoning — not repeated here.
--
-- All three tables are written ONLY via the service-role client
-- (src/lib/supabase/service.ts) from Next.js API routes under
-- src/app/api/mou-sign/[token]/*. There is deliberately no INSERT policy
-- for `anon`/`authenticated` on any of them — an unauthenticated signer
-- proves who they are via the token + OTP, not via a Supabase Auth
-- session, so there is no `authenticated` role to grant here at all for
-- the signer's side of this flow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. mou_sign_requests
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mou_sign_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Which MOU text this request is for. Free text, not a FK to a
    -- templates table — there's exactly one template today (the Founding
    -- Partner MOU) and versioning it as a string in the signed record is
    -- enough to know which wording a given signature legally attached to,
    -- without building a template-management feature nobody asked for.
    template_version text NOT NULL DEFAULT 'founding-partner-v1',

    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'signed', 'expired', 'cancelled')),

    -- Who WOS is sending this to. Denormalized (not a FK to users) on
    -- purpose: the signer is frequently a prospective partner who has no
    -- users row yet. signer_phone is E.164-ish free text, validated at
    -- the API layer (src/lib/phone.ts already has this for the rest of
    -- the app) rather than with a CHECK here.
    signer_name text NOT NULL,
    signer_email text,
    signer_phone text,
    delivery_channel text NOT NULL DEFAULT 'email'
        CHECK (delivery_channel IN ('email', 'line')),

    -- Never store the raw token — same reasoning as
    -- trip_partner_links.access_token_hash (088_trip_partner_links.sql).
    token_hash text NOT NULL UNIQUE,
    token_expires_at timestamptz NOT NULL,

    created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    sent_at timestamptz,
    cancelled_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mou_sign_requests_org
    ON public.mou_sign_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_mou_sign_requests_status
    ON public.mou_sign_requests(status);

ALTER TABLE public.mou_sign_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mou_sign_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read mou_sign_requests" ON public.mou_sign_requests;
CREATE POLICY "Platform admins can read mou_sign_requests" ON public.mou_sign_requests
    FOR SELECT
    USING (public.is_platform_admin());

-- No INSERT/UPDATE/DELETE policy for authenticated/anon — every write
-- (create link, mark sent, mark signed/expired/cancelled) goes through
-- an admin or mou-sign API route using the service-role client.

-- ----------------------------------------------------------------------------
-- 2. mou_otp_codes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mou_otp_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sign_request_id uuid NOT NULL REFERENCES public.mou_sign_requests(id) ON DELETE CASCADE,

    channel text NOT NULL CHECK (channel IN ('email', 'sms')),
    destination text NOT NULL, -- the email/phone the code was actually sent to

    -- sha256 of the 6-digit code, same "hash, never store raw" rule as
    -- token_hash above. A leaked mou_otp_codes row should be as useless
    -- to an attacker as a leaked password row.
    code_hash text NOT NULL,

    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,

    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mou_otp_codes_sign_request
    ON public.mou_otp_codes(sign_request_id, created_at DESC);

ALTER TABLE public.mou_otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mou_otp_codes FORCE ROW LEVEL SECURITY;
-- No policies at all: nobody needs to read this table except the
-- service-role verify-otp route, which bypasses RLS. Not even platform
-- admins get a read policy — codes are short-lived and hashed, there is
-- nothing useful to audit here (the *result* of verification is what
-- mou_signatures.verification_method / otp_verified_at records).

-- ----------------------------------------------------------------------------
-- 3. mou_signatures — APPEND-ONLY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mou_signatures (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sign_request_id uuid NOT NULL REFERENCES public.mou_sign_requests(id) ON DELETE RESTRICT,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,

    signed_at timestamptz NOT NULL DEFAULT now(),

    signer_name text NOT NULL,
    signer_email text,
    signer_phone text,
    signer_ip text NOT NULL,
    signer_user_agent text,

    verification_method text NOT NULL
        CHECK (verification_method IN ('email_otp', 'sms_otp', 'thaid')),
    otp_verified_at timestamptz,

    -- Path inside the private `mou-documents` Storage bucket, e.g.
    -- "signed/{organization_id}/{sign_request_id}.pdf" — resolved to a
    -- signed URL on demand (src/lib/storage/signed-slip-url.ts already
    -- established this pattern for another private bucket), never a
    -- public URL, and never stored as one.
    document_storage_path text NOT NULL,
    document_sha256 text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mou_signatures_org
    ON public.mou_signatures(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mou_signatures_sign_request
    ON public.mou_signatures(sign_request_id); -- one completed signature per request

ALTER TABLE public.mou_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mou_signatures FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read mou_signatures" ON public.mou_signatures;
CREATE POLICY "Platform admins can read mou_signatures" ON public.mou_signatures
    FOR SELECT
    USING (public.is_platform_admin());

-- Append-only enforcement at the table level — see 073_audit_log.sql for
-- the full reasoning. Reuses the same trigger function (it just raises,
-- doesn't touch audit_log specifically) but each table needs its own
-- trigger binding.
DROP TRIGGER IF EXISTS prevent_mou_signatures_update ON public.mou_signatures;
CREATE TRIGGER prevent_mou_signatures_update
    BEFORE UPDATE ON public.mou_signatures
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS prevent_mou_signatures_delete ON public.mou_signatures;
CREATE TRIGGER prevent_mou_signatures_delete
    BEFORE DELETE ON public.mou_signatures
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_audit_log_mutation();

-- ----------------------------------------------------------------------------
-- 4. Private Storage bucket for signed PDFs
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('mou-documents', 'mou-documents', false, 20 * 1024 * 1024, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 20 * 1024 * 1024,
    allowed_mime_types = ARRAY['application/pdf'];

-- No storage.objects policy is added for anon/authenticated, matching
-- 033_private_payment_slips.sql's reasoning: service_role (used by every
-- route that touches this bucket) bypasses RLS entirely, so
-- createSignedUrl()/upload() from server code keep working with zero
-- policies, and nobody else can read or write these objects at all.

-- ============================================================================
-- VERIFY after running:
--   select policyname, cmd from pg_policies where tablename = 'mou_signatures';
--   -- expect exactly one row: ("Platform admins can read mou_signatures", SELECT)
--
--   update public.mou_signatures set signer_name = 'x' where id = (select id from public.mou_signatures limit 1);
--   delete from public.mou_signatures where id = (select id from public.mou_signatures limit 1);
--   -- both must raise "audit_log is append-only: ... operations are not
--   -- allowed" once at least one signature row exists.
-- ============================================================================
