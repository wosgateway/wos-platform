-- ============================================================================
-- 100_mou_sign_requests_review_fixes.sql
--
-- Follow-up to 099_mou_sign_requests.sql, addressing review feedback
-- before the flow goes live for the first real Founding Partner
-- signature.
--
-- Additive only — this uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS
-- throughout rather than editing 099 in place, in case 099 has already
-- been applied somewhere.
-- ============================================================================
-- What changed and why:
--
--   1. mou_sign_requests gains template_path / template_hash, captured
--      at request-creation time (not just at signing time), so we can
--      later answer "what exact bytes was this partner invited to
--      sign" — not just a version label that could in principle have
--      been swapped on disk between invite and signature.
--
--   2. mou_sign_requests.status gains an 'otp_verified' state, so the
--      admin list can distinguish "link sent" from "partner started
--      verifying" from "fully signed" — this was the status table
--      requested in review.
--
--   3. Email delivery is tracked as two separate, updatable columns on
--      mou_sign_requests: invite_email_status (the initial "here's your
--      link" email) and signed_email_status (the final signed-PDF
--      email). Deliberately NOT added to mou_signatures — that table is
--      append-only (073's trigger blocks UPDATE/DELETE even for
--      service_role), and email delivery is exactly the kind of thing
--      that gets retried/updated after the row already exists. Signing
--      status and email status are now independent: a Resend outage
--      shows up as "Signed / Email Failed", never as "Signing Failed".
--
--   4. mou_signatures gains template_path, template_hash (the values
--      actually used to render THIS signed PDF — written once at
--      INSERT, so still compatible with append-only) and
--      signature_short_id, a short human-showable reference ("WOS
--      Signature ID") that now appears on the PDF instead of the raw IP
--      address. IP / User-Agent / OTP verification detail continue to
--      live in this table only, never stamped onto a document a partner
--      takes outside WOS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- mou_sign_requests
-- ----------------------------------------------------------------------------
ALTER TABLE public.mou_sign_requests
    ADD COLUMN IF NOT EXISTS template_path text,
    ADD COLUMN IF NOT EXISTS template_hash text,
    ADD COLUMN IF NOT EXISTS otp_verified_at timestamptz,
    ADD COLUMN IF NOT EXISTS invite_email_status text NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS invite_email_error text,
    ADD COLUMN IF NOT EXISTS signed_email_status text NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS signed_email_error text;

ALTER TABLE public.mou_sign_requests
    DROP CONSTRAINT IF EXISTS mou_sign_requests_status_check;
ALTER TABLE public.mou_sign_requests
    ADD CONSTRAINT mou_sign_requests_status_check
    CHECK (status IN ('pending', 'otp_verified', 'signed', 'expired', 'cancelled'));

ALTER TABLE public.mou_sign_requests
    DROP CONSTRAINT IF EXISTS mou_sign_requests_invite_email_status_check;
ALTER TABLE public.mou_sign_requests
    ADD CONSTRAINT mou_sign_requests_invite_email_status_check
    CHECK (invite_email_status IN ('pending', 'sent', 'failed'));

ALTER TABLE public.mou_sign_requests
    DROP CONSTRAINT IF EXISTS mou_sign_requests_signed_email_status_check;
ALTER TABLE public.mou_sign_requests
    ADD CONSTRAINT mou_sign_requests_signed_email_status_check
    CHECK (signed_email_status IN ('pending', 'sent', 'failed'));

-- Rows created under 099 (before this migration, if any) will have null
-- template_path/template_hash — left null deliberately rather than
-- guessed; they predate this guarantee. Nothing in this repo's current
-- stage should have real signed rows yet.

-- ----------------------------------------------------------------------------
-- mou_signatures — additive columns only. The append-only trigger from
-- 099 is unaffected: it fires on UPDATE/DELETE, never on adding a
-- column or on the single INSERT each row ever receives.
-- ----------------------------------------------------------------------------
ALTER TABLE public.mou_signatures
    ADD COLUMN IF NOT EXISTS template_path text,
    ADD COLUMN IF NOT EXISTS template_hash text,
    ADD COLUMN IF NOT EXISTS signature_short_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mou_signatures_short_id
    ON public.mou_signatures(signature_short_id)
    WHERE signature_short_id IS NOT NULL;

-- Once the accompanying app-code changes are deployed, every new row
-- populates these three columns, so a later migration can safely
-- tighten them to NOT NULL once no in-flight sign requests created
-- under the pre-100 code path remain

-- ============================================================================
-- VERIFY after running:
--   select column_name from information_schema.columns
--   where table_name = 'mou_sign_requests'
--   and column_name in ('template_path','template_hash','invite_email_status','signed_email_status');
--   -- expect 4 rows
--
--   select column_name from information_schema.columns
--   where table_name = 'mou_signatures'
--   and column_name in ('template_path','template_hash','signature_short_id');
--   -- expect 3 rows
--
--   select conname from pg_constraint where conname = 'mou_sign_requests_status_check';
--   -- confirm the updated CHECK (includes 'otp_verified') took effect
-- ============================================================================
