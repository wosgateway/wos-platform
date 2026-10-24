begin;
alter table public.ai_conversation_state
  add column pending_request_id uuid,
  add column pending_service_query text,
  add column pending_service_source text,
  add column pending_service_created_at timestamptz,
  add constraint ai_state_pending_complete check (
    (pending_request_id is null and pending_service_query is null
      and pending_service_source is null and pending_service_created_at is null)
    or
    (pending_request_id is not null and pending_service_query is not null
      and length(btrim(pending_service_query)) > 0
      and pending_service_source is not null
      and pending_service_source in ('explicit-service','symptom')
      and pending_service_created_at is not null)
  );
alter table public.ai_conversation_state enable row level security;
revoke all privileges on table public.ai_conversation_state
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.ai_conversation_state to service_role;
comment on column public.ai_conversation_state.pending_service_source is
  'Semantic evidence source only; never lookup authorization.';
commit;