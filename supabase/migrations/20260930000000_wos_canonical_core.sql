-- Phase 1: OWNER-APPROVED canonical core, fresh disposable databases ONLY.
-- Not an upgrade/replay of the historical schema. No seeds or AI state variant.
-- PROVEN: organization/branch/user primitives (001), partners starting shape (006),
-- organization/branch links (010/072), catalog visibility (050/053), search (122).
-- OWNER-DECIDED: packages, admin attribute/role, fail-closed tenant helpers,
-- operation-specific privileges, promotion output alias and integer minutes.
-- INFERRED objects: NONE. Adjacent payment/handoff/telemetry are not installed.
begin;

do $$
begin
  if current_setting('wos.canonical_environment', true) is distinct from 'disposable-local' then
    raise exception 'Explicit disposable-local qualification setting required';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname=current_user and rolsuper) then
    raise exception 'Disposable bootstrap administrator required (local Supabase: supabase_admin)';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'wos_core_security_owner') then
    raise exception 'Fresh security owner role required; existing role will not be modified';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('partners','packages','organizations','branches','users')
  ) then
    raise exception 'Fresh canonical core required; existing tables will not be replaced';
  end if;
end $$;

-- OWNER-DECIDED: no provider default table/sequence/function grants carried forward.
alter default privileges in schema public revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from public, anon, authenticated, service_role;
create role wos_core_security_owner nologin nosuperuser nocreatedb nocreaterole
  noinherit noreplication nobypassrls password null;

-- PROVEN reconstructed shape accepted by owner; no additional partner fields.
create table public.partners (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  category text not null check (category in ('Hospital','Clinic','Dental','Wellness','Spa','Hotel','Transport')),
  description text,
  rating numeric(2,1) default 0,
  province text,
  logo_url text,
  cover_image_url text,
  gallery_urls jsonb default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  review_count integer default 0
);

-- PROVEN identity primitives. These are NOT the customer packages ownership model.
create table public.organizations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null,
  slug text unique,
  logo_url text, cover_image_url text, description text, website_url text,
  phone text, email text, address text, province text,
  country text default 'Thailand', settings jsonb default '{}'::jsonb,
  status text default 'active', tier text default 'free', subscription_status text default 'active',
  trial_ends_at timestamptz, subscription_ends_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  partner_id uuid references public.partners(id) on delete set null
);
create table public.branches (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, address text, province text, phone text, email text,
  latitude numeric(10,8), longitude numeric(11,8), status text default 'active',
  created_at timestamptz default now(), updated_at timestamptz default now(),
  partner_id uuid references public.partners(id) on delete set null
);
create table public.users (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  email text not null unique, password_hash text, supabase_user_id uuid unique,
  full_name text not null, phone text, role text default 'staff',
  permissions jsonb default '[]'::jsonb, avatar_url text, status text default 'active',
  last_login_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  -- OWNER-DECIDED: nullable flags fail closed; no client may write this attribute.
  is_platform_admin boolean default false
);

-- PROVEN 094 + provisioning contract: one non-NULL branch link per partner.
-- Correctness/identity constraint, not a performance index; no data rewrite.
create unique index uq_branches_partner_id on public.branches(partner_id)
  where partner_id is not null;

-- OWNER-DECIDED canonical catalog. The only stored promotion flag is promotion.
create table public.packages (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete restrict,
  title text not null, description text, image_url text, sub_category text,
  original_price numeric(12,2) not null default 0,
  special_price numeric(12,2),
  status text not null default 'draft' check (status in ('draft','published','pending','rejected','archived')),
  is_active boolean not null default true,
  promotion boolean not null default false,
  gallery_urls text[] not null default '{}',
  max_guests integer check (max_guests is null or max_guests > 0),
  amenities text[] not null default '{}',
  duration integer,
  -- PROVEN timestamp dependency: existing catalog queries sort by created_at.
  created_at timestamptz default now(), updated_at timestamptz default now()
);
comment on column public.packages.duration is 'Canonical integer minutes; NULL means unspecified.';
comment on column public.packages.promotion is 'Canonical stored flag; is_promotion is an output compatibility name only.';

-- K3: only PK/UNIQUE identity indexes, including the proven 094 branch link.
-- PostgreSQL does not require FK indexes.
-- No performance indexes and no organization-owned partner_packages conversion.
revoke all on public.partners,public.packages,public.organizations,public.branches,public.users
  from public,anon,authenticated,service_role;
alter table public.partners enable row level security;
alter table public.packages enable row level security;
alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.users enable row level security;

-- Dedicated owner can read only the identity columns used by audited helpers.
grant usage,create on schema public to wos_core_security_owner;
grant usage on schema auth to wos_core_security_owner;
grant execute on function auth.uid() to wos_core_security_owner;
grant select (id,organization_id,branch_id,supabase_user_id,is_platform_admin) on public.users to wos_core_security_owner;
grant select (id,partner_id) on public.organizations to wos_core_security_owner;
grant select (id,organization_id,partner_id) on public.branches to wos_core_security_owner;
grant select (id) on public.partners to wos_core_security_owner;
create policy security_identity_users on public.users for select to wos_core_security_owner using (true);
create policy security_identity_orgs on public.organizations for select to wos_core_security_owner using (true);
create policy security_identity_branches on public.branches for select to wos_core_security_owner using (true);
create policy security_identity_partners on public.partners for select to wos_core_security_owner using (true);

-- OWNER-DECIDED body: zero/multiple/NULL identities cannot become administrators.
create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select count(*) = 1 and coalesce(bool_and(u.is_platform_admin),false)
  from public.users u where u.supabase_user_id=auth.uid()
$$;
alter function public.is_platform_admin() owner to wos_core_security_owner;

-- OWNER D10: branch ownership is authoritative. The optional organization
-- partner link may be absent; if present it must agree. Standalone catalog
-- partners do not create user ownership. No sentinel or ambiguous LIMIT 1.
create function public.wos_core_mapping()
returns table(organization_id uuid,branch_id uuid,partner_id uuid)
language sql stable security definer set search_path=pg_catalog as $$
  select o.id,b.id,p.id
  from public.users u
  join public.organizations o on o.id=u.organization_id
  join public.branches b on b.id=u.branch_id and b.organization_id=o.id
  join public.partners p on p.id=b.partner_id and (o.partner_id is null or p.id=o.partner_id)
  where u.supabase_user_id=auth.uid()
    and (select count(*) from public.users x where x.supabase_user_id=auth.uid())=1
    and (select count(*) from public.users x
      join public.organizations xo on xo.id=x.organization_id
      join public.branches xb on xb.id=x.branch_id and xb.organization_id=xo.id
      join public.partners xp on xp.id=xb.partner_id and (xo.partner_id is null or xp.id=xo.partner_id)
      where x.supabase_user_id=auth.uid())=1
$$;
alter function public.wos_core_mapping() owner to wos_core_security_owner;
create function public.current_user_organization_id() returns uuid
language sql stable security definer set search_path=pg_catalog as $$
  select m.organization_id from public.wos_core_mapping() m
$$;
create function public.current_user_branch_id() returns uuid
language sql stable security definer set search_path=pg_catalog as $$
  select m.branch_id from public.wos_core_mapping() m
$$;
create function public.current_user_partner_id() returns uuid
language sql stable security definer set search_path=pg_catalog as $$
  select m.partner_id from public.wos_core_mapping() m
$$;
alter function public.current_user_organization_id() owner to wos_core_security_owner;
alter function public.current_user_branch_id() owner to wos_core_security_owner;
alter function public.current_user_partner_id() owner to wos_core_security_owner;
revoke create on schema public from wos_core_security_owner;
revoke all on function public.wos_core_mapping() from public,anon,authenticated,service_role;
revoke all on function public.is_platform_admin(),public.current_user_organization_id(),
  public.current_user_branch_id(),public.current_user_partner_id() from public,anon,authenticated,service_role;
-- Specific own-identity RPC operations, required by authenticated RLS/API callers.
-- This is not EXECUTE ON ALL FUNCTIONS, nor any blanket table grant.
grant execute on function public.is_platform_admin(),public.current_user_organization_id(),
  public.current_user_branch_id(),public.current_user_partner_id() to authenticated;

-- PROVEN public catalog visibility (050/053), explicit per-table SELECT only.
create policy catalog_partners on public.partners for select to anon,authenticated using (status='active');
create policy catalog_packages on public.packages for select to anon,authenticated using (status='published' and is_active);
create policy owned_partners_read on public.partners for select to authenticated
  using (id=public.current_user_partner_id() or public.is_platform_admin());
create policy owned_packages_read on public.packages for select to authenticated
  using (partner_id=public.current_user_partner_id() or public.is_platform_admin());
create policy owned_packages_insert on public.packages for insert to authenticated
  with check (partner_id=public.current_user_partner_id() or public.is_platform_admin());
create policy owned_packages_update on public.packages for update to authenticated
  using (partner_id=public.current_user_partner_id() or public.is_platform_admin())
  with check (partner_id=public.current_user_partner_id() or public.is_platform_admin());
create policy owned_packages_delete on public.packages for delete to authenticated
  using (partner_id=public.current_user_partner_id() or public.is_platform_admin());
create policy owned_partner_profile_update on public.partners for update to authenticated
  using (id=public.current_user_partner_id() or public.is_platform_admin())
  with check (id=public.current_user_partner_id() or public.is_platform_admin());
create policy own_org_read on public.organizations for select to authenticated
  using (id=public.current_user_organization_id() or public.is_platform_admin());
create policy own_branch_read on public.branches for select to authenticated
  using (id=public.current_user_branch_id() or public.is_platform_admin());
create policy own_user_read on public.users for select to authenticated
  using (supabase_user_id=auth.uid() or public.is_platform_admin());
grant select on public.partners,public.packages to anon,authenticated;
grant insert,update,delete on public.packages to authenticated;
-- PROVEN profile contract fields only; neither tenants nor admins get blanket
-- direct UPDATE of partner category/status/rating through this profile operation.
grant update(name,description,province,logo_url,cover_image_url) on public.partners to authenticated;
grant select on public.organizations,public.branches to authenticated;
grant select(id,organization_id,branch_id,email,supabase_user_id,full_name,phone,role,
  permissions,avatar_url,status,last_login_at,created_at,updated_at) on public.users to authenticated;
-- OWNER-DECIDED trusted backend catalog read only. BYPASSRLS is not a write grant.
grant select on public.partners,public.packages to service_role;

-- PROVEN search algorithm, OWNER-DECIDED storage/output compatibility and units.
create function public.strip_thai_tone_marks(input text) returns text
language sql immutable parallel safe set search_path=pg_catalog as $$
  select regexp_replace(input,'[\u0E48-\u0E4B]','','g')
$$;
create function public.search_packages_thai(search_term text,result_limit integer default 10)
returns table(id uuid,partner_id uuid,title text,description text,image_url text,
  is_promotion boolean,original_price numeric,special_price numeric,duration integer,
  status text,is_active boolean,sub_category text,partner_id_out uuid,partner_name text,
  partner_category text,partner_status text,partner_province text)
language sql stable security invoker set search_path=pg_catalog as $$
  select p.id,p.partner_id,p.title,p.description,p.image_url,p.promotion,
    p.original_price,p.special_price,p.duration,p.status,p.is_active,p.sub_category,
    pt.id,pt.name,pt.category,pt.status,pt.province
  from public.packages p join public.partners pt on pt.id=p.partner_id
  where nullif(btrim(search_term),'') is not null
    and p.status='published' and p.is_active and pt.status='active'
    and (public.strip_thai_tone_marks(p.title) ilike '%'||public.strip_thai_tone_marks(search_term)||'%'
      or public.strip_thai_tone_marks(coalesce(p.description,'')) ilike '%'||public.strip_thai_tone_marks(search_term)||'%'
      or public.strip_thai_tone_marks(pt.name) ilike '%'||public.strip_thai_tone_marks(search_term)||'%'
      or public.strip_thai_tone_marks(coalesce(pt.province,'')) ilike '%'||public.strip_thai_tone_marks(search_term)||'%')
  order by p.title limit greatest(1,least(coalesce(result_limit,10),10))
$$;
revoke all on function public.strip_thai_tone_marks(text),public.search_packages_thai(text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.strip_thai_tone_marks(text),public.search_packages_thai(text,integer)
  to anon,authenticated,service_role;

-- PROVEN trigger behavior, fixed path; caller privileges/RLS remain in force.
create function public.handle_updated_at() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin new.updated_at=now(); return new; end $$;
revoke all on function public.handle_updated_at() from public,anon,authenticated,service_role;
create trigger canonical_organizations_updated before update on public.organizations
  for each row execute function public.handle_updated_at();
create trigger canonical_branches_updated before update on public.branches
  for each row execute function public.handle_updated_at();
create trigger canonical_users_updated before update on public.users
  for each row execute function public.handle_updated_at();
create trigger canonical_packages_updated before update on public.packages
  for each row execute function public.handle_updated_at();
commit;
