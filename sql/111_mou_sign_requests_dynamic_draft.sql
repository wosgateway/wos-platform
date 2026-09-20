-- ============================================================
-- 111_mou_sign_requests_dynamic_draft.sql
--
-- Closes a gap flagged during MOU e-sign review: the MOU PDF text
-- (partner/organization name + commercial fee %, MOU ข้อ 3) was a
-- single static file (legal/mou-templates/{template_version}.pdf) —
-- every partner saw the exact same printed %, regardless of what
-- partner_commercial_terms.commercial_fee_rate actually said for
-- them (098). Two partners on different negotiated rates would be
-- shown/signing the same wrong document unless someone hand-prepared
-- a separate static PDF per partner and remembered to pick the right
-- one — error-prone and doesn't scale past a handful of partners.
--
-- Fix (application-layer, see src/lib/mou/pdf.ts fillMouDraft() +
-- create-sign-request/route.ts): at the moment an admin sends a sign
-- request, generate a per-request PDF with the partner's actual name
-- + commercial_fee_rate drawn onto the template, store it in the
-- `mou-documents` bucket (same bucket signed docs already live in,
-- under drafts/ instead of signed/), and have BOTH the preview
-- endpoints and the final signature-stamping step operate on that
-- same generated file — never the blank template — for any request
-- created after this migration.
--
-- commercial_fee_rate_snapshot follows the exact same reasoning as
-- order_items.commission_rate_snapshot (103): partner_commercial_terms
-- is a live/period table, so without freezing the rate that was
-- actually PRINTED on the document a signer saw, a later rate change
-- would make it impossible to tell what % a given signed MOU actually
-- committed to. Frozen at creation time, in the same transaction as
-- the row insert, so it can never drift from the file.
--
-- draft_storage_path is nullable on purpose — existing sign requests
-- created before this migration have no generated draft and keep
-- falling back to the blank on-disk template (see pdf.ts's
-- loadMouBaseDocument), so this is backward-compatible, not a backfill.
--
-- Idempotent — safe to re-run, same convention as the rest of /sql.
-- ============================================================

BEGIN;

ALTER TABLE public.mou_sign_requests
    ADD COLUMN IF NOT EXISTS commercial_fee_rate_snapshot NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS draft_storage_path TEXT;

COMMENT ON COLUMN public.mou_sign_requests.commercial_fee_rate_snapshot IS
    'partner_commercial_terms.commercial_fee_rate at the moment this sign request was created — the % actually printed on draft_storage_path. NULL for legacy rows predating dynamic draft generation.';

COMMENT ON COLUMN public.mou_sign_requests.draft_storage_path IS
    'Path in the mou-documents Storage bucket (drafts/{organization_id}/{id}.pdf) of the per-request PDF with this partner''s name + rate filled in. NULL for legacy rows, which fall back to the blank on-disk template.';

COMMIT;
