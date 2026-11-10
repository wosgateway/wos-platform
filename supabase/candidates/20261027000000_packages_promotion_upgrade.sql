-- UNSTAGED upgrade candidate for an existing legacy public.packages table.
-- Requires the historical boolean is_promotion column; not a fresh bootstrap.
-- Review production dependencies and remaining legacy writers before applying.
-- This is a one-time backfill, not ongoing synchronization of the two flags.
begin;

alter table public.packages
  add column if not exists promotion boolean;

update public.packages
set promotion = coalesce(is_promotion, false)
where promotion is null;

alter table public.packages
  alter column promotion set default false,
  alter column promotion set not null;

commit;
