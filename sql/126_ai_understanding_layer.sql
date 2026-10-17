-- 126_ai_understanding_layer.sql
-- Tables required by src/lib/ai/understanding/* (state.ts, provinces.ts).
-- All access is via the service-role client, so RLS is enabled with NO policies
-- (anon/authenticated get nothing; service role bypasses RLS).
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) provinces  (read by loadProvinces: id,name_th,name_en,name_lo,aliases, is_active)
-- ---------------------------------------------------------------------------
create table if not exists public.provinces (
  id        text primary key,                 -- slug, e.g. 'udon-thani'
  name_th   text not null,
  name_en   text,
  name_lo   text,
  aliases   text[] not null default '{}',     -- e.g. {'อุดร','udon'}
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.provinces enable row level security;

-- ---------------------------------------------------------------------------
-- 2) ai_conversation_state  (loadState / saveState / clearState)
--    upsert uses onConflict: 'conversation_id'  -> must be PK/unique
-- ---------------------------------------------------------------------------
create table if not exists public.ai_conversation_state (
  conversation_id     text primary key,
  channel             text,
  province_id         text,
  last_catalog        jsonb,
  catalog_query       jsonb,
  catalog_offset      integer not null default 0,
  selected_program_id text,
  catalog_updated_at  timestamptz,
  updated_at          timestamptz not null default now()
);
alter table public.ai_conversation_state enable row level security;

create or replace function public.touch_ai_conversation_state()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_ai_conversation_state on public.ai_conversation_state;
create trigger trg_touch_ai_conversation_state
  before update on public.ai_conversation_state
  for each row execute function public.touch_ai_conversation_state();

-- ---------------------------------------------------------------------------
-- 3) ai_requests  (logAiRequest: one row per gate decision)
--    Stores length + SHA-256 by default; message_text only when AI_LOG_TEXT=true.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_requests (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  conversation_id text,
  channel         text not null,
  mode            text not null check (mode in ('shadow','on')),
  message_len     integer not null,
  message_sha256  text not null,
  message_text    text,
  language        text,
  intent          text,
  confidence      numeric,
  entities        jsonb,
  action          text,
  defer_reason    text,
  handled         boolean not null default false,
  latency_ms      integer,
  error           text
);
create index if not exists ai_requests_created_at_idx on public.ai_requests (created_at desc);
create index if not exists ai_requests_conversation_idx on public.ai_requests (conversation_id, created_at desc);
alter table public.ai_requests enable row level security;

-- ---------------------------------------------------------------------------
-- 4) Seed: ONLY provinces that appear in the code/tests. VERIFY before applying:
--    aliases must match how customers write them, and the province names must
--    match partners.province (free text) so coveredProvinceIds() can map them.
--    Run the "distinct partners.province" check first and adjust this list.
-- ---------------------------------------------------------------------------
insert into public.provinces (id, name_th, name_en, name_lo, aliases) values
  ('udon-thani', 'อุดรธานี', 'Udon Thani', null, array['อุดร','udon']),
  ('nong-khai',  'หนองคาย',  'Nong Khai',  null, array['nong khai']),
  ('khon-kaen',  'ขอนแก่น',  'Khon Kaen',  null, array['ขอนแก่น','khon kaen'])
on conflict (id) do nothing;
