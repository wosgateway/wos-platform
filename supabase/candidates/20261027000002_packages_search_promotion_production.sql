-- PRODUCTION-EXECUTABLE PHASE 2 CANDIDATE; NOT EXECUTED/DEPLOYED.
-- Standalone reviewed artifact: do not replay the local-only migration chain.
-- Prerequisite: qualified Phase 1 completed, correct project and migration history verified.
-- Owner supplied evidence says installed RPC matches sql/122; validate again at execution.
-- Retains stored is_promotion; no synchronization, grants, application changes or cleanup.
-- Single-use: an already canonical or otherwise different RPC is rejected.
begin;
do $guard$
declare
  p pg_catalog.pg_proc;
  q pg_catalog.pg_proc;
  before_arguments text;
  before_result text;
begin
  select * into p from pg_catalog.pg_proc
    where oid=to_regprocedure('public.search_packages_thai(text,integer)');
  if p.oid is null or p.prosrc is distinct from $expected$
  select
    p.id,
    p.partner_id,
    p.title,
    p.description,
    p.image_url,
    p.is_promotion,
    p.original_price,
    p.special_price,
    p.duration,
    p.status,
    p.is_active,
    p.sub_category,
    pt.id as partner_id_out,
    pt.name as partner_name,
    pt.category as partner_category,
    pt.status as partner_status,
    pt.province as partner_province
  from packages p
  inner join partners pt on pt.id = p.partner_id
  where p.status = 'published'
    and p.is_active = true
    and pt.status = 'active'
    and (
      strip_thai_tone_marks(p.title) ilike '%' || strip_thai_tone_marks(search_term) || '%'
      or strip_thai_tone_marks(coalesce(p.description, '')) ilike '%' || strip_thai_tone_marks(search_term) || '%'
      or strip_thai_tone_marks(pt.name) ilike '%' || strip_thai_tone_marks(search_term) || '%'
      or strip_thai_tone_marks(coalesce(pt.province, '')) ilike '%' || strip_thai_tone_marks(search_term) || '%'
    )
  order by p.title asc
  limit result_limit;
$expected$
     or pg_get_function_arguments(p.oid) <> 'search_term text, result_limit integer DEFAULT 10'
     or pg_get_function_result(p.oid) <> 'TABLE(id uuid, partner_id uuid, title text, description text, image_url text, is_promotion boolean, original_price numeric, special_price numeric, duration text, status text, is_active boolean, sub_category text, partner_id_out uuid, partner_name text, partner_category text, partner_status text, partner_province text)'
     or pg_get_userbyid(p.proowner) <> 'postgres'
     or p.prosecdef or p.provolatile <> 's' or p.proconfig is not null
     or p.prolang <> (select oid from pg_language where lanname='sql') then
    raise exception 'Exact repository legacy RPC required; do not replace unknown RPC';
  end if;
  if not exists (select 1 from pg_attribute where attrelid='public.packages'::regclass
    and attname='promotion' and atttypid='boolean'::regtype and attnotnull and not attisdropped) then
    raise exception 'Canonical boolean promotion required';
  end if;

  before_arguments := pg_get_function_arguments(p.oid);
  before_result := pg_get_function_result(p.oid);
  execute $replacement$
create or replace function public.search_packages_thai(
  search_term text,
  result_limit int default 10
)
returns table (
  id uuid,
  partner_id uuid,
  title text,
  description text,
  image_url text,
  is_promotion boolean,
  original_price numeric,
  special_price numeric,
  duration text,
  status text,
  is_active boolean,
  sub_category text,
  partner_id_out uuid,
  partner_name text,
  partner_category text,
  partner_status text,
  partner_province text
)
language sql
stable
as $$
  select
    p.id,
    p.partner_id,
    p.title,
    p.description,
    p.image_url,
    p.promotion,
    p.original_price,
    p.special_price,
    p.duration,
    p.status,
    p.is_active,
    p.sub_category,
    pt.id as partner_id_out,
    pt.name as partner_name,
    pt.category as partner_category,
    pt.status as partner_status,
    pt.province as partner_province
  from packages p
  inner join partners pt on pt.id = p.partner_id
  where p.status = 'published'
    and p.is_active = true
    and pt.status = 'active'
    and (
      strip_thai_tone_marks(p.title) ilike '%' || strip_thai_tone_marks(search_term) || '%'
      or strip_thai_tone_marks(coalesce(p.description, '')) ilike '%' || strip_thai_tone_marks(search_term) || '%'
      or strip_thai_tone_marks(pt.name) ilike '%' || strip_thai_tone_marks(search_term) || '%'
      or strip_thai_tone_marks(coalesce(pt.province, '')) ilike '%' || strip_thai_tone_marks(search_term) || '%'
    )
  order by p.title asc
  limit result_limit;
$$;
  $replacement$;
  select * into q from pg_catalog.pg_proc where oid=p.oid;
  if q.oid is null
     or q.prosrc is distinct from replace(p.prosrc,'p.is_promotion,','p.promotion,')
     or pg_get_function_arguments(q.oid) is distinct from before_arguments
     or pg_get_function_result(q.oid) is distinct from before_result
     or q.proowner is distinct from p.proowner
     or q.proacl is distinct from p.proacl
     or q.prosecdef is distinct from p.prosecdef
     or q.proconfig is distinct from p.proconfig
     or q.provolatile is distinct from p.provolatile
     or q.proparallel is distinct from p.proparallel
     or q.proisstrict is distinct from p.proisstrict
     or q.proleakproof is distinct from p.proleakproof
     or q.procost is distinct from p.procost
     or q.prorows is distinct from p.prorows then
    raise exception 'RPC preservation check failed; transaction must roll back';
  end if;
end $guard$;
commit;
