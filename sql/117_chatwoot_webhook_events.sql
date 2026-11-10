-- ============================================================
-- 117_chatwoot_webhook_events.sql
--
-- Idempotency ledger for the Chatwoot webhook (/api/chatwoot/webhook).
-- Replaces the in-memory `processedMessageIds` Map() in route.ts,
-- which does not survive across serverless instances or cold starts
-- on Vercel — a real risk once this webhook calls AI Core V1, since a
-- duplicate Chatwoot webhook delivery would otherwise fire a duplicate
-- OpenAI call (and duplicate reply to the customer).
--
-- IDEMPOTENCY MODEL (same claim-then-resolve pattern as 095):
-- One row per chatwoot_message_id, enforced by a unique constraint.
-- The webhook CLAIMS a message by inserting a 'processing' row BEFORE
-- calling the AI — if a duplicate webhook delivery races in, the
-- second insert hits the unique constraint (Postgres 23505) and the
-- app treats that as "already being handled, skip" instead of calling
-- OpenAI again. See src/lib/chatwoot/duplicate.ts.
--
-- TRADEOFF (documented, not hidden): a row stuck at 'processing' (the
-- serverless function crashed or timed out mid-request) permanently
-- blocks a retry of that exact message id. Unlike a scheduled job, a
-- dropped reply here is visible to the customer immediately (they see
-- no answer) and they can simply resend their message, which arrives
-- as a new chatwoot_message_id — so this is acceptable for v1. An
-- admin can delete the stuck row directly if a resend of the same
-- message id is ever needed.
--
-- Idempotent. Safe to re-run.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chatwoot_webhook_event_status') then
    create type chatwoot_webhook_event_status as enum ('processing', 'sent', 'failed');
  end if;
end$$;

create table if not exists public.chatwoot_webhook_events (
  id uuid primary key default gen_random_uuid(),
  chatwoot_message_id bigint not null,
  conversation_id bigint not null,

  status chatwoot_webhook_event_status not null default 'processing',
  -- populated on 'failed' only (error class, e.g. 'openai_429',
  -- 'openai_error', 'chatwoot_send_failed') — never raw error bodies
  -- or customer content, matching the no-raw-response-body logging
  -- rule already followed elsewhere in this webhook.
  reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chatwoot_webhook_events_one_per_message unique (chatwoot_message_id)
);

create index if not exists idx_chatwoot_webhook_events_conversation on public.chatwoot_webhook_events(conversation_id);
create index if not exists idx_chatwoot_webhook_events_status on public.chatwoot_webhook_events(status);

-- reuses public.set_updated_at(), already defined in migration 076.
-- CREATE TRIGGER has no IF NOT EXISTS in Postgres — drop-then-create
-- is the standard idempotent pattern.
drop trigger if exists chatwoot_webhook_events_set_updated_at on public.chatwoot_webhook_events;
create trigger chatwoot_webhook_events_set_updated_at
  before update on public.chatwoot_webhook_events
  for each row execute function public.set_updated_at();

-- Deny-by-default posture, same as every other service-role-only
-- table in this project (e.g. 095): no anon/authenticated policy. All
-- access goes through the webhook's service-role Supabase client.
-- ENABLE ROW LEVEL SECURITY is already idempotent on its own (no error
-- on re-run); CREATE POLICY is not, so it gets the same drop-then-
-- create treatment as the trigger above.
alter table public.chatwoot_webhook_events enable row level security;

drop policy if exists "service_role_only_chatwoot_webhook_events" on public.chatwoot_webhook_events;
create policy "service_role_only_chatwoot_webhook_events"
  on public.chatwoot_webhook_events for all using (false);

commit;

-- ============================================================
-- OPERATIONAL REFERENCE — not executed by this migration.
--
-- Rows stuck at 'processing' (serverless function crashed or timed
-- out mid-request, per this file's header comment) block a retry of
-- that exact chatwoot_message_id. Check for a backlog before assuming
-- everything is healthy:
--
--   select id, chatwoot_message_id, conversation_id, created_at
--   from public.chatwoot_webhook_events
--   where status = 'processing'
--     and created_at < now() - interval '5 minutes'
--   order by created_at desc;
--
-- A handful of rows younger than a minute or two is normal (requests
-- in flight). A growing count older than ~5 minutes means requests
-- are dying mid-flight — check Vercel function logs and OpenAI status
-- before deleting rows. Delete a specific stuck row only after
-- confirming its request actually failed:
--
--   delete from public.chatwoot_webhook_events where id = '<uuid>';
-- ============================================================
