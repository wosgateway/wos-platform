-- 087_protect_partners_line_user_id_column.sql
--
-- Closes a gap flagged in review of migration 086: partners.line_user_id
-- is meant to be admin-set-only, but the existing "Partners can update
-- own profile" RLS policy (see 051_formalize_partners_update_own_profile.sql)
-- is ROW-level, not column-level:
--
--   USING (id = current_user_partner_id())
--   WITH CHECK (id = current_user_partner_id())
--
-- That policy only checks WHICH ROW is being touched, never WHICH
-- COLUMNS. Today's app code (CompanyProfile.tsx, the partner-portal's
-- own-profile editor) only ever sends an explicit whitelist
-- (name/description/province/logo_url/cover_image_url) that excludes
-- line_user_id — but that's an application-layer promise, not a
-- database one. Nothing stops a partner-portal user from constructing
-- their own request (browser dev tools, a raw call to the Supabase
-- REST endpoint with their own session token) that includes
-- line_user_id in the update payload for their own partner row; RLS
-- alone would allow it since it only checks row ownership.
--
-- This is the same class of gap 070_harden_partner_profile_ownership.sql
-- closed for a different endpoint (an RPC trusting its caller-supplied
-- id) — defense at the layer that actually enforces the boundary,
-- not just the UI that happens to not expose it today.
--
-- Fix: a trigger that reverts line_user_id to its previous value
-- whenever it changes and the actor is NOT one of:
--   - a platform admin (is_platform_admin() — the same check every
--     other admin-only partners policy in this codebase already uses)
--   - the service_role (auth.role() = 'service_role' — our own
--     server-side code via createServiceClient(), e.g. the admin API
--     routes, always runs as this; RLS doesn't apply to it but
--     triggers still fire on every write regardless of RLS, so this
--     role check is what keeps our own trusted backend code working)
--
-- Reverting (not raising) so an unrelated legitimate update to other
-- columns on the same row doesn't fail outright just because a stray
-- line_user_id happened to be present in the payload; only the
-- disallowed column change is undone. Logs a warning either way so an
-- actual attempt shows up somewhere.

create or replace function public.protect_partners_line_user_id()
returns trigger
language plpgsql
as $$
begin
  if new.line_user_id is distinct from old.line_user_id
     and coalesce(auth.role(), '') <> 'service_role'
     and not is_platform_admin()
  then
    raise warning 'blocked non-admin attempt to change partners.line_user_id for partner %', old.id;
    new.line_user_id := old.line_user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_partners_line_user_id on public.partners;

create trigger trg_protect_partners_line_user_id
  before update on public.partners
  for each row
  execute function public.protect_partners_line_user_id();

-- ============================================================
-- QA — run after applying.
-- ============================================================
-- (a) As a partner-portal user (their own JWT), attempt:
--   UPDATE public.partners SET line_user_id = 'Uattacker' WHERE id = <own partner id>;
--   -- Expected: 1 row "succeeds" (RLS still allows touching the row),
--   -- but SELECT line_user_id afterward shows it UNCHANGED — the
--   -- trigger silently reverted just that column.
-- (b) As platform admin (is_platform_admin() = true), same statement
--   -- Expected: line_user_id actually changes.
-- (c) Via service_role (e.g. createServiceClient() in admin API routes)
--   -- Expected: unaffected — admin-facing writes keep working exactly
--   -- as before this migration.
