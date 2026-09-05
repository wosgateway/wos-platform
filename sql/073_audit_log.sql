-- ============================================================================
-- 073_audit_log.sql
--
-- Append-only audit trail for admin actions. Added 2026-09-04 after the
-- near-miss where the logged-in admin's own account was one UPDATE away
-- from being cascade-deleted along with a test organization — there was
-- no record of *why* that org existed or who touched it, which made the
-- incident harder to reason about after the fact than it should have been.
--
-- Design notes:
--   - Rows are written by API routes using the service-role client
--     (src/lib/supabase/service.ts), which bypasses RLS entirely — so
--     there is deliberately NO insert policy for `authenticated` below.
--     Client-side code should never insert here directly; it should call
--     an admin API route, which logs server-side after requireAdmin()
--     passes. This keeps "an audit entry exists" a reliable signal that
--     an authorized admin action actually happened, not just that
--     someone with a valid session called .insert() from the browser.
--   - No UPDATE or DELETE policy for anyone (including platform admins)
--     on purpose — an audit log that can be edited or cleared by the
--     same admins it's supposed to be checking on isn't much of one.
--     If a row is ever wrong, add a correcting row rather than editing.
--   - actor_email is denormalized (kept even if the user is later
--     removed from public.users/Auth) so old entries stay legible.
--   - before/after are nullable jsonb snapshots of the affected row's
--     relevant columns, not the whole table — keep them small and
--     specific to what changed, not full table dumps.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),

    actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email text,

    -- Dot-namespaced, e.g. 'partner.suspend', 'partner.reactivate',
    -- 'partner.provision', 'payment.verify', 'payment.reject'.
    -- Free text (no CHECK) so new action types don't need a migration —
    -- same tradeoff already made for public.cases.status in 006.
    action text NOT NULL,

    entity_type text NOT NULL,
    entity_id uuid,

    before jsonb,
    after jsonb,
    metadata jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- Defense-in-depth only — RLS (forced or not) never applies to the
-- service-role client, which is what every write path in this codebase
-- uses (see src/lib/supabase/service.ts). The real enforcement is the
-- triggers below; this line is here so a future non-service-role write
-- path (e.g. someone adding a plain postgres-role connection) doesn't
-- get a silent exception to RLS as the table owner.
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read audit_log" ON public.audit_log;
CREATE POLICY "Platform admins can read audit_log" ON public.audit_log
    FOR SELECT
    USING (public.is_platform_admin());

-- No INSERT/UPDATE/DELETE policy for `authenticated` — see design notes
-- above. Writes only ever happen via the service-role client, which
-- bypasses RLS, so no policy is needed (or wanted) for that path.

-- ============================================================================
-- Append-only enforcement (trigger-level, not just RLS)
--
-- Every write path in this codebase uses the service-role client, which
-- bypasses RLS entirely — so "no UPDATE/DELETE policy" above stops a
-- browser client but does nothing to stop a bug (or a future route)
-- that calls serviceRole.from('audit_log').update(...)/.delete(...).
-- These triggers close that gap at the table level: they fire for ANY
-- role, service-role included, so an audit row genuinely cannot be
-- edited or removed by application code once written — only a
-- superuser/table-owner acting directly on the database (outside the
-- app entirely) could bypass this, which is a different, much smaller
-- trust boundary than "any code holding the service-role key."
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % operations are not allowed', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS prevent_audit_log_update ON public.audit_log;
CREATE TRIGGER prevent_audit_log_update
    BEFORE UPDATE ON public.audit_log
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS prevent_audit_log_delete ON public.audit_log;
CREATE TRIGGER prevent_audit_log_delete
    BEFORE DELETE ON public.audit_log
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_audit_log_mutation();

-- ============================================================================
-- VERIFY after running:
--   select policyname, cmd from pg_policies where tablename = 'audit_log';
--   -- expect exactly one row: ("Platform admins can read audit_log", SELECT)
--
--   -- These triggers are FOR EACH ROW, so they only fire on rows that are
--   -- actually matched — `WHERE false` matches zero rows and the trigger
--   -- body never runs, silently "succeeding" with 0 rows affected. To
--   -- actually test enforcement, target a real row (safe: both statements
--   -- below are expected to fail before touching anything) — run this
--   -- only after at least one row exists (e.g. after testing partner
--   -- suspend/reactivate once through the app), otherwise `id = (select
--   -- id ... limit 1)` is NULL and matches nothing either:
--   update public.audit_log set action = 'test' where id = (select id from public.audit_log limit 1);
--   delete from public.audit_log where id = (select id from public.audit_log limit 1);
--   -- both must raise "audit_log is append-only: ... operations are not
--   -- allowed" — if either instead reports "0 rows" or succeeds, the
--   -- triggers are not wired up correctly.
-- ============================================================================
