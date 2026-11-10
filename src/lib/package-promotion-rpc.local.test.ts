import {describe,it,expect,beforeEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url));
const read=(p:string)=>readFileSync(path.join(root,p),'utf8');
const container=process.env.WOS_PROMOTION_LOCAL_CONTAINER;
const token=process.env.WOS_PROMOTION_LOCAL_TOKEN;
const config=process.env.WOS_PROMOTION_DOCKER_CONFIG;
const host=process.platform==='win32'?'npipe:////./pipe/docker_engine':'unix:///var/run/docker.sock';
function docker(args:string[],input?:string){
 if(!container||!token||!config)throw Error('Run npm run test:promotion:local');
 const r=spawnSync('docker',['--host',host,'--config',config,...args],{input,encoding:'utf8',timeout:15000});
 if(r.status!==0)throw Error(r.stderr||String(r.error));return r.stdout.trim();
}
function sql(query:string){
 // Fail closed BEFORE any SQL: only the exact new no-network/no-volume test container.
 const [info]=JSON.parse(docker(['inspect',container!]));
 if(info.Id!==container||info.Config.Labels?.['wos.promotion.disposable']!==token||info.HostConfig.NetworkMode!=='none'
   ||info.Mounts.some((m:{Type:string})=>m.Type!=='tmpfs')||Object.keys(info.HostConfig.PortBindings??{}).length)throw Error('Unsafe local container');
 return docker(['exec','-i',container!,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','wos_promotion_disposable','-At'],query);
}
const artifact=()=>read('supabase/candidates/20261028000000_packages_search_promotion_production.sql');
const metadata="select oid::text||'|'||pg_get_function_arguments(oid)||'|'||pg_get_function_result(oid)||'|'||proowner::text||'|'||proacl::text||'|'||prosecdef::text||'|'||coalesce(proconfig::text,'NULL') from pg_proc where oid='public.search_packages_thai(text,integer)'::regprocedure";
function fixture(crlf=false,legacyColumn=true){
 let legacy=read('sql/122_thai_search_normalize.sql').replace(/\r\n/g,'\n');
 legacy=legacy.slice(legacy.indexOf('create or replace function strip_thai_tone_marks'));
 if(crlf)legacy=legacy.replace(/\n/g,'\r\n');
 sql('drop schema public cascade;create schema public;create table partners(id uuid primary key,name text,category text,status text,province text);create table packages(id uuid primary key,partner_id uuid,title text,description text,image_url text,'+(legacyColumn?'is_promotion boolean,':'')+'promotion boolean not null default false,original_price numeric,special_price numeric,duration text,status text,is_active boolean,sub_category text);');
 sql(legacy);
 sql("do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end $$;grant execute on function search_packages_thai(text,integer) to public,anon,authenticated,postgres,service_role;");
 sql("insert into partners values ('00000000-0000-0000-0000-000000000001','Clinic','Clinic','active','อุดรธานี');insert into packages(id,partner_id,title,promotion,is_promotion,duration,status,is_active) values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','ตรวจเข่า',true,false,'60 minutes','published',true)");
}
const body=()=>sql("select encode(convert_to(prosrc,'UTF8'),'hex') from pg_proc where oid='search_packages_thai(text,integer)'::regprocedure");
const search="select is_promotion::text||'|'||duration from search_packages_thai('ตรวจเขา',5)";
describe.skipIf(!container)('real SQL, isolated disposable PostgreSQL only',()=>{
 beforeEach(()=>fixture());
 it.each([false,true])('preserves exact installed bytes, signature, owner and ACL with CRLF=%s',crlf=>{
  fixture(crlf);const before=sql(metadata);const source=Buffer.from(body(),'hex').toString('utf8');sql(artifact());
  expect(sql(metadata)).toBe(before);expect(Buffer.from(body(),'hex').toString('utf8')).toBe(source.replace('p.is_promotion,','p.promotion,'));
  expect(sql(search)).toBe('true|60 minutes');
 });
 it.each([true,false])('follows canonical flag despite legacy disagreement: %s',flag=>{
  sql(artifact());sql('update packages set promotion='+flag+',is_promotion='+!flag);expect(sql(search)).toBe(flag+'|60 minutes');
 });
 it('backfills null values without overwriting canonical values on rerun',()=>{
  sql('truncate packages;alter table packages alter column promotion drop not null');
  sql("insert into packages(id,is_promotion,promotion) select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,case n when 1 then true when 2 then false else null end,case n when 4 then true when 5 then false else null end from generate_series(1,5)n");
  const migration=read('supabase/candidates/20261027000000_packages_promotion_upgrade.sql');sql(migration);expect(sql('select promotion from packages order by id')).toBe('t\nf\nf\nt\nf');sql('update packages set is_promotion=not promotion');sql(migration);expect(sql('select promotion from packages order by id')).toBe('t\nf\nf\nt\nf');
 });
 it('supports canonical-only storage after replacement',()=>{sql(artifact());sql('alter table packages drop column is_promotion');expect(sql(search)).toBe('true|60 minutes');});
 it('retains normalization, text duration, ordering, limit and visibility',()=>{
  sql("insert into packages(id,partner_id,title,promotion,is_promotion,duration,status,is_active) select '00000000-0000-0000-0000-000000000003',partner_id,'ตรวจเข่า Z',false,false,'arbitrary text','published',true from packages limit 1");
  const q="select title||'|'||duration from search_packages_thai('ตรวจเขา',1)";const before=sql(q);sql(artifact());expect(sql(q)).toBe(before);expect(sql("select count(*) from search_packages_thai('ตรวจเขา',5)")).toBe('2');sql("update packages set status='pending'");expect(sql(search)).toBe('');sql("update packages set status='published',is_active=false");expect(sql(search)).toBe('');sql("update packages set is_active=true;update partners set status='inactive'");expect(sql(search)).toBe('');
 });
 it('rejects signature mismatch before mutation',()=>{
  sql('alter function search_packages_thai(text,integer) rename to search_fixture_original');
  expect(()=>sql(artifact())).toThrow('Exact repository legacy RPC');expect(sql("select count(*) from pg_proc where proname='search_packages_thai'")).toBe('0');
 });
 it('rejects canonical rerun and preserves the installed body',()=>{sql(artifact());const source=body();expect(()=>sql(artifact())).toThrow('Exact repository legacy RPC');expect(body()).toBe(source);});
 it('rejects semantic drift even when line endings normalize',()=>{
  const legacy=read('sql/122_thai_search_normalize.sql');const start=legacy.indexOf('create or replace function search_packages_thai(');sql(legacy.slice(start,legacy.indexOf('$$;',start)+3).replace('limit result_limit','limit 1'));const source=body();expect(()=>sql(artifact())).toThrow('Exact repository legacy RPC');expect(body()).toBe(source);
 });
 it('rolls back atomically if replacement changes an unqualified attribute',()=>{sql('alter function search_packages_thai(text,integer) cost 123');const source=body();expect(()=>sql(artifact())).toThrow('preservation check failed');expect(body()).toBe(source);expect(sql("select procost from pg_proc where oid='search_packages_thai(text,integer)'::regprocedure")).toBe('123');});
});
