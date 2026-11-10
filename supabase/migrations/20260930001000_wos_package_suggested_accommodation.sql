-- OWNER D09: new additive decision, not a claim of historical DDL provenance.
-- Apply explicitly after the Phase 1 canonical core, never by replaying history.
begin;
do $$ begin
  if current_setting('wos.canonical_environment',true) is distinct from 'disposable-local' then
    raise exception 'Explicit disposable-local qualification setting required';
  end if;
end $$;
alter table public.packages
  add column suggested_hotel_name text,
  add column suggested_hotel_price_note text;
comment on column public.packages.suggested_hotel_name is
  'Suggested accommodation metadata only; not a booking, reservation or guarantee.';
comment on column public.packages.suggested_hotel_price_note is
  'Suggested accommodation note only; never canonical package or booking price.';
commit;
