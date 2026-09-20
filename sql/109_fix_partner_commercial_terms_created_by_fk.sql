-- ============================================================================
-- 109_fix_partner_commercial_terms_created_by_fk.sql
--
-- BUG: 101_partner_commercial_terms_history.sql defined
--
--   created_by UUID REFERENCES public.users(id) ON DELETE SET NULL
--
-- but the only caller — PATCH /api/admin/partner-commercial-terms
-- (via start_partner_commercial_term_period(), sql/101) — has always
-- passed `admin.user.id` from requireAdmin(), which is auth.users.id
-- (the Supabase Auth UID returned by supabase.auth.getUser()), NOT
-- public.users.id.
--
-- public.users has its OWN generated primary key
-- (001_schema_and_rls.sql: `id UUID PRIMARY KEY DEFAULT
-- gen_random_uuid()`), with the auth UID stored in a SEPARATE
-- `supabase_user_id` column instead — the same distinction
-- src/lib/partner/auth.ts's getPartnerSession() already relies on
-- (`.eq('supabase_user_id', verifiedUser.id)`). So the UUID being
-- inserted as created_by essentially never matches any
-- public.users.id row, and every INSERT via
-- start_partner_commercial_term_period() has violated
-- partner_commercial_terms_created_by_fkey since 101 shipped —
-- exactly the error being hit now.
--
-- audit_log.actor_user_id (073) already gets this right for the
-- identical value (admin.user.id from requireAdmin()):
--
--   actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
--
-- Fix: point partner_commercial_terms.created_by at auth.users(id)
-- instead of public.users(id) — same target, same reasoning, as
-- audit_log. No application code change needed: admin.user.id was
-- always the right VALUE to pass, only the FK's REFERENCES target
-- was wrong.
--
-- No data backfill needed: 101's own backfill never set created_by
-- on pre-existing rows (only effective_from), and every post-101
-- INSERT attempt that tried to set a non-null created_by has been
-- rolling back on this exact constraint — so there is nothing
-- already committed under the old, wrong FK to reconcile.
--
-- Idempotent — safe to re-run, same convention as the rest of /sql.
-- ============================================================================

ALTER TABLE public.partner_commercial_terms
    DROP CONSTRAINT IF EXISTS partner_commercial_terms_created_by_fkey;

ALTER TABLE public.partner_commercial_terms
    ADD CONSTRAINT partner_commercial_terms_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- VERIFY after running:
--
--   select conname, confrelid::regclass
--   from pg_constraint
--   where conname = 'partner_commercial_terms_created_by_fkey';
--   -- expect: confrelid = 'auth.users'
--
--   -- then retry the PATCH that was failing (start a new rate period
--   -- for any partner from the admin UI) — should succeed now.
-- ============================================================================
