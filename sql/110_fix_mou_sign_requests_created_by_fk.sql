-- ============================================================================
-- 110_fix_mou_sign_requests_created_by_fk.sql
--
-- BUG: 099_mou_sign_requests.sql defined
--
--   created_by uuid REFERENCES public.users(id) ON DELETE SET NULL
--
-- but the only caller — POST /api/admin/mou/create-sign-request — has
-- always passed `auth.user.id` from requireAdmin(), which is
-- auth.users.id (the Supabase Auth UID returned by
-- supabase.auth.getUser()), NOT public.users.id.
--
-- public.users has its OWN generated primary key
-- (001_schema_and_rls.sql: `id UUID PRIMARY KEY DEFAULT
-- gen_random_uuid()`), with the auth UID stored in a SEPARATE
-- `supabase_user_id` column instead. So the UUID being inserted as
-- created_by essentially never matches any public.users.id row, and
-- every INSERT via create-sign-request/route.ts would violate
-- mou_sign_requests_created_by_fkey the first time an admin used it.
--
-- Exact same bug, same root cause, same fix as
-- 109_fix_partner_commercial_terms_created_by_fk.sql — see that file's
-- header for the full write-up (audit_log.actor_user_id already gets
-- this right for the identical value: `REFERENCES auth.users(id)`).
--
-- Fix: point mou_sign_requests.created_by at auth.users(id) instead of
-- public.users(id). No application code change needed: auth.user.id
-- was always the right VALUE to pass, only the FK's REFERENCES target
-- was wrong.
--
-- No data backfill needed: this table has never shipped a working
-- create path (every INSERT attempt with a non-null created_by would
-- have rolled back on this exact constraint) — nothing already
-- committed under the old, wrong FK to reconcile.
--
-- Idempotent — safe to re-run, same convention as the rest of /sql.
-- ============================================================================

ALTER TABLE public.mou_sign_requests
    DROP CONSTRAINT IF EXISTS mou_sign_requests_created_by_fkey;

ALTER TABLE public.mou_sign_requests
    ADD CONSTRAINT mou_sign_requests_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- VERIFY after running:
--
--   select conname, confrelid::regclass
--   from pg_constraint
--   where conname = 'mou_sign_requests_created_by_fkey';
--   -- expect: confrelid = 'auth.users'
--
--   -- then retry POST /api/admin/mou/create-sign-request for any
--   -- organization from the admin UI — should succeed now.
-- ============================================================================
