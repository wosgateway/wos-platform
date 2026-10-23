-- Additive web ownership only. Never execute against a database in this phase.
create table public.web_ai_sessions (
  id uuid primary key default gen_random_uuid(),
  verifier text not null unique check (verifier ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  last_admitted_at timestamptz not null,
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  check (idle_expires_at <= absolute_expires_at)
);
create table public.web_ai_conversations (
  selector uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.web_ai_sessions(id),
  internal_id text not null unique default ('web:' || gen_random_uuid()::text)
    check (internal_id ~ '^web:[0-9a-f-]{36}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index web_ai_conversations_owner on public.web_ai_conversations(owner_id);
create index web_ai_sessions_expiry on public.web_ai_sessions(absolute_expires_at, idle_expires_at);
create index web_ai_conversations_expiry on public.web_ai_conversations(expires_at);
alter table public.web_ai_sessions enable row level security;
alter table public.web_ai_conversations enable row level security;
revoke all on public.web_ai_sessions, public.web_ai_conversations from public, anon, authenticated;
-- Application code uses only RPCs. Prevent accidental direct service-role writes.
revoke all on public.web_ai_sessions, public.web_ai_conversations from service_role;

create function public.web_ai_create_conversation(p_verifier text, p_new_session boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare s public.web_ai_sessions%rowtype; c public.web_ai_conversations%rowtype; t timestamptz;
begin
  if p_verifier is null or p_verifier !~ '^[0-9a-f]{64}$' or p_new_session is null then
    return jsonb_build_object('status',401);
  end if;
  if p_new_session then
    t := clock_timestamp();
    insert into public.web_ai_sessions(verifier,created_at,last_admitted_at,idle_expires_at,absolute_expires_at)
      values(p_verifier,t,t,t+interval '30 minutes',t+interval '24 hours') returning * into s;
  else
    select * into s from public.web_ai_sessions where verifier=p_verifier for update;
    t := clock_timestamp();
    if not found or s.revoked_at is not null or t>=s.idle_expires_at or t>=s.absolute_expires_at then
      return jsonb_build_object('status',401);
    end if;
  end if;
  -- Creation never refreshes inactivity. Session+conversation creation is atomic.
  insert into public.web_ai_conversations(owner_id,created_at,expires_at)
    values(s.id,t,t+interval '24 hours') returning * into c;
  return jsonb_build_object('status',200,'selector',c.selector);
end $$;

create function public.web_ai_admit(p_verifier text, p_selector uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare s public.web_ai_sessions%rowtype; c public.web_ai_conversations%rowtype; t timestamptz;
begin
  -- Admission/revocation always lock session first, then conversation.
  select * into s from public.web_ai_sessions where verifier=p_verifier for update;
  t := clock_timestamp();
  if not found or s.revoked_at is not null or t>=s.idle_expires_at or t>=s.absolute_expires_at then
    return jsonb_build_object('status',401);
  end if;
  select * into c from public.web_ai_conversations where selector=p_selector and owner_id=s.id for update;
  t := clock_timestamp();
  if not found or c.revoked_at is not null or t>=c.expires_at then
    return jsonb_build_object('status',404);
  end if;
  -- Recheck after waiting on the conversation lock. No expiry can revive.
  if t>=s.idle_expires_at or t>=s.absolute_expires_at then
    return jsonb_build_object('status',401);
  end if;
  update public.web_ai_sessions set last_admitted_at=t,
    idle_expires_at=least(t+interval '30 minutes',absolute_expires_at) where id=s.id;
  -- RPC transaction commit is admission. Only after RPC success may core run.
  return jsonb_build_object('status',200,'internal_id',c.internal_id);
end $$;

-- Service-only revocation primitive, not a public endpoint. A null selector revokes session.
create function public.web_ai_revoke(p_owner uuid, p_selector uuid default null)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform 1 from public.web_ai_sessions where id=p_owner for update;
  if not found then return; end if;
  if p_selector is null then
    update public.web_ai_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_owner;
  else
    perform 1 from public.web_ai_conversations where selector=p_selector and owner_id=p_owner for update;
    update public.web_ai_conversations set revoked_at=coalesce(revoked_at,clock_timestamp())
      where selector=p_selector and owner_id=p_owner;
  end if;
end $$;

-- Ownership ceases when either its conversation or its owner session expires/
-- revokes. Retain auth/ownership records seven days after that effective end.
-- Conversation expires_at remains fixed; AI state is never deleted.
-- No scheduler is installed. Operation requires separate rollout authorization.
create function public.web_ai_cleanup()
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  -- Same lock order as admission/revoke, including during retention cleanup.
  perform 1 from public.web_ai_sessions order by id for update;
  delete from public.web_ai_conversations c using public.web_ai_sessions s
    where c.owner_id=s.id and least(c.expires_at,coalesce(c.revoked_at,c.expires_at),
      s.idle_expires_at,s.absolute_expires_at,coalesce(s.revoked_at,s.absolute_expires_at))
      <= clock_timestamp()-interval '7 days';
  delete from public.web_ai_sessions s
    where least(idle_expires_at,absolute_expires_at,coalesce(revoked_at,absolute_expires_at)) <= clock_timestamp()-interval '7 days'
    and not exists(select 1 from public.web_ai_conversations c where c.owner_id=s.id);
end $$;

revoke all on function public.web_ai_create_conversation(text,boolean), public.web_ai_admit(text,uuid),
  public.web_ai_revoke(uuid,uuid), public.web_ai_cleanup() from public, anon, authenticated;
grant execute on function public.web_ai_create_conversation(text,boolean), public.web_ai_admit(text,uuid),
  public.web_ai_revoke(uuid,uuid), public.web_ai_cleanup() to service_role;
