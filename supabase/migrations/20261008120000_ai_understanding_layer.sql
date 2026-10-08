-- ============================================================
-- 126_ai_understanding_layer.sql
-- Purpose: data model for the Fern Understanding layer (WOS AI v1).
--   1) provinces            canonical geography + aliases (replaces 3 hard-coded
--                           province lists: programs.ts, journey-state.ts, province.ts)
--   2) ai_conversation_state last catalog shown / selection per conversation
--                           (today re-derived from history by regex on every turn)
--   3) ai_requests          observability: intent/confidence/action per request
--                           (source of new eval cases)
-- Idempotent. Does NOT touch partners / packages / programs.
-- Catalog source of truth stays: packages JOIN partners (published + active).
-- ============================================================
begin;

-- 1) provinces ------------------------------------------------
create table if not exists public.provinces (
  id           text primary key,
  country_code text not null default 'TH' check (char_length(country_code) = 2),
  name_th      text not null,
  name_en      text,
  name_lo      text,
  aliases      text[] not null default '{}',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint provinces_name_th_unique unique (name_th)
);

drop trigger if exists set_updated_at_provinces on public.provinces;
create trigger set_updated_at_provinces
  before update on public.provinces
  for each row execute function public.handle_updated_at();

alter table public.provinces enable row level security;
drop policy if exists "Public can read active provinces" on public.provinces;
create policy "Public can read active provinces" on public.provinces
  for select to anon, authenticated using (is_active = true);
revoke insert, update, delete on public.provinces from anon, authenticated;

-- Seed = the 77 Thai provinces + aliases that already exist in code today.
-- Lao names are only filled for the provinces WOS serves most; REVIEW them, then add more
-- by UPDATE (new province / alias needs no code change). Never overwrites existing rows.
insert into public.provinces (id, name_th, name_en, name_lo, aliases) values
  ('bangkok', 'กรุงเทพมหานคร', 'Bangkok', 'ບາງກອກ', array['กรุงเทพ', 'กรุงเทพฯ', 'กทม', 'กทม.', 'bangkok', 'bkk']::text[]),
  ('krabi', 'กระบี่', 'Krabi', null, array['krabi']::text[]),
  ('kanchanaburi', 'กาญจนบุรี', 'Kanchanaburi', null, array['kanchanaburi']::text[]),
  ('kalasin', 'กาฬสินธุ์', 'Kalasin', null, array['kalasin']::text[]),
  ('kamphaeng-phet', 'กำแพงเพชร', 'Kamphaeng Phet', null, array['kamphaeng phet', 'kamphaengphet']::text[]),
  ('khon-kaen', 'ขอนแก่น', 'Khon Kaen', 'ຂອນແກ່ນ', array['khon kaen', 'khonkaen']::text[]),
  ('chanthaburi', 'จันทบุรี', 'Chanthaburi', null, array['chanthaburi']::text[]),
  ('chachoengsao', 'ฉะเชิงเทรา', 'Chachoengsao', null, array['chachoengsao']::text[]),
  ('chon-buri', 'ชลบุรี', 'Chon Buri', null, array['chon buri', 'chonburi']::text[]),
  ('chai-nat', 'ชัยนาท', 'Chai Nat', null, array['chai nat', 'chainat']::text[]),
  ('chaiyaphum', 'ชัยภูมิ', 'Chaiyaphum', null, array['chaiyaphum']::text[]),
  ('chumphon', 'ชุมพร', 'Chumphon', null, array['chumphon']::text[]),
  ('chiang-rai', 'เชียงราย', 'Chiang Rai', null, array['chiang rai', 'chiangrai']::text[]),
  ('chiang-mai', 'เชียงใหม่', 'Chiang Mai', 'ຊຽງໃໝ່', array['chiang mai', 'chiangmai']::text[]),
  ('trang', 'ตรัง', 'Trang', null, array['trang']::text[]),
  ('trat', 'ตราด', 'Trat', null, array['trat']::text[]),
  ('tak', 'ตาก', 'Tak', null, array['tak']::text[]),
  ('nakhon-nayok', 'นครนายก', 'Nakhon Nayok', null, array['nakhon nayok', 'nakhonnayok']::text[]),
  ('nakhon-pathom', 'นครปฐม', 'Nakhon Pathom', null, array['nakhon pathom', 'nakhonpathom']::text[]),
  ('nakhon-phanom', 'นครพนม', 'Nakhon Phanom', null, array['nakhon phanom', 'nakhonphanom']::text[]),
  ('nakhon-ratchasima', 'นครราชสีมา', 'Nakhon Ratchasima', null, array['โคราช', 'nakhon ratchasima', 'nakhonratchasima']::text[]),
  ('nakhon-si-thammarat', 'นครศรีธรรมราช', 'Nakhon Si Thammarat', null, array['นครศรี', 'nakhon si thammarat', 'nakhonsithammarat']::text[]),
  ('nakhon-sawan', 'นครสวรรค์', 'Nakhon Sawan', null, array['nakhon sawan', 'nakhonsawan']::text[]),
  ('nonthaburi', 'นนทบุรี', 'Nonthaburi', null, array['nonthaburi']::text[]),
  ('narathiwat', 'นราธิวาส', 'Narathiwat', null, array['narathiwat']::text[]),
  ('nan', 'น่าน', 'Nan', null, array['nan']::text[]),
  ('bueng-kan', 'บึงกาฬ', 'Bueng Kan', null, array['bueng kan', 'buengkan']::text[]),
  ('buriram', 'บุรีรัมย์', 'Buriram', null, array['buriram']::text[]),
  ('pathum-thani', 'ปทุมธานี', 'Pathum Thani', null, array['pathum thani', 'pathumthani']::text[]),
  ('prachuap-khiri-khan', 'ประจวบคีรีขันธ์', 'Prachuap Khiri Khan', null, array['ประจวบ', 'prachuap khiri khan', 'prachuapkhirikhan']::text[]),
  ('prachin-buri', 'ปราจีนบุรี', 'Prachin Buri', null, array['prachin buri', 'prachinburi']::text[]),
  ('pattani', 'ปัตตานี', 'Pattani', null, array['pattani']::text[]),
  ('phra-nakhon-si-ayutthaya', 'พระนครศรีอยุธยา', 'Phra Nakhon Si Ayutthaya', null, array['อยุธยา', 'phra nakhon si ayutthaya', 'phranakhonsiayutthaya']::text[]),
  ('phayao', 'พะเยา', 'Phayao', null, array['phayao']::text[]),
  ('phang-nga', 'พังงา', 'Phang Nga', null, array['phang nga', 'phangnga']::text[]),
  ('phatthalung', 'พัทลุง', 'Phatthalung', null, array['phatthalung']::text[]),
  ('phichit', 'พิจิตร', 'Phichit', null, array['phichit']::text[]),
  ('phitsanulok', 'พิษณุโลก', 'Phitsanulok', null, array['phitsanulok']::text[]),
  ('phetchaburi', 'เพชรบุรี', 'Phetchaburi', null, array['phetchaburi']::text[]),
  ('phetchabun', 'เพชรบูรณ์', 'Phetchabun', null, array['phetchabun']::text[]),
  ('phrae', 'แพร่', 'Phrae', null, array['phrae']::text[]),
  ('phuket', 'ภูเก็ต', 'Phuket', 'ພູເກັດ', array['phuket']::text[]),
  ('maha-sarakham', 'มหาสารคาม', 'Maha Sarakham', null, array['maha sarakham', 'mahasarakham']::text[]),
  ('mukdahan', 'มุกดาหาร', 'Mukdahan', null, array['mukdahan']::text[]),
  ('mae-hong-son', 'แม่ฮ่องสอน', 'Mae Hong Son', null, array['mae hong son', 'maehongson']::text[]),
  ('yala', 'ยะลา', 'Yala', null, array['yala']::text[]),
  ('yasothon', 'ยโสธร', 'Yasothon', null, array['yasothon']::text[]),
  ('roi-et', 'ร้อยเอ็ด', 'Roi Et', null, array['roi et', 'roiet']::text[]),
  ('ranong', 'ระนอง', 'Ranong', null, array['ranong']::text[]),
  ('rayong', 'ระยอง', 'Rayong', null, array['rayong']::text[]),
  ('ratchaburi', 'ราชบุรี', 'Ratchaburi', null, array['ratchaburi']::text[]),
  ('lopburi', 'ลพบุรี', 'Lopburi', null, array['lopburi']::text[]),
  ('lampang', 'ลำปาง', 'Lampang', null, array['lampang']::text[]),
  ('lamphun', 'ลำพูน', 'Lamphun', null, array['lamphun']::text[]),
  ('loei', 'เลย', 'Loei', null, array['loei']::text[]),
  ('si-sa-ket', 'ศรีสะเกษ', 'Si Sa Ket', null, array['si sa ket', 'sisaket']::text[]),
  ('sakon-nakhon', 'สกลนคร', 'Sakon Nakhon', null, array['sakon nakhon', 'sakonnakhon']::text[]),
  ('songkhla', 'สงขลา', 'Songkhla', null, array['songkhla']::text[]),
  ('satun', 'สตูล', 'Satun', null, array['satun']::text[]),
  ('samut-prakan', 'สมุทรปราการ', 'Samut Prakan', null, array['samut prakan', 'samutprakan']::text[]),
  ('samut-songkhram', 'สมุทรสงคราม', 'Samut Songkhram', null, array['samut songkhram', 'samutsongkhram']::text[]),
  ('samut-sakhon', 'สมุทรสาคร', 'Samut Sakhon', null, array['samut sakhon', 'samutsakhon']::text[]),
  ('sa-kaeo', 'สระแก้ว', 'Sa Kaeo', null, array['sa kaeo', 'sakaeo']::text[]),
  ('saraburi', 'สระบุรี', 'Saraburi', null, array['saraburi']::text[]),
  ('sing-buri', 'สิงห์บุรี', 'Sing Buri', null, array['sing buri', 'singburi']::text[]),
  ('sukhothai', 'สุโขทัย', 'Sukhothai', null, array['sukhothai']::text[]),
  ('suphan-buri', 'สุพรรณบุรี', 'Suphan Buri', null, array['suphan buri', 'suphanburi']::text[]),
  ('surat-thani', 'สุราษฎร์ธานี', 'Surat Thani', null, array['สุราษฎร์', 'surat thani', 'suratthani']::text[]),
  ('surin', 'สุรินทร์', 'Surin', null, array['surin']::text[]),
  ('nong-khai', 'หนองคาย', 'Nong Khai', 'ໜອງຄາຍ', array['nong khai', 'nongkhai']::text[]),
  ('nong-bua-lamphu', 'หนองบัวลำภู', 'Nong Bua Lamphu', null, array['nong bua lamphu', 'nongbualamphu']::text[]),
  ('ang-thong', 'อ่างทอง', 'Ang Thong', null, array['ang thong', 'angthong']::text[]),
  ('amnat-charoen', 'อำนาจเจริญ', 'Amnat Charoen', null, array['amnat charoen', 'amnatcharoen']::text[]),
  ('udon-thani', 'อุดรธานี', 'Udon Thani', 'ອຸດອນທານີ', array['อุดร', 'อຸດອນ', 'ອຸດອນ', 'ອຸດອນທານີ', 'ອຸດຮ', 'ອຸດຣ', 'udon', 'udon thani', 'udonthani']::text[]),
  ('uttaradit', 'อุตรดิตถ์', 'Uttaradit', null, array['uttaradit']::text[]),
  ('uthai-thani', 'อุทัยธานี', 'Uthai Thani', null, array['uthai thani', 'uthaithani']::text[]),
  ('ubon-ratchathani', 'อุบลราชธานี', 'Ubon Ratchathani', null, array['อุบล', 'ubon ratchathani', 'ubonratchathani']::text[])
on conflict (id) do nothing;

-- 2) ai_conversation_state -----------------------------------
create table if not exists public.ai_conversation_state (
  conversation_id     text primary key check (char_length(conversation_id) <= 128),
  channel             text not null default 'chatwoot' check (char_length(channel) <= 32),
  province_id         text references public.provinces(id) on delete set null,
  last_catalog        jsonb not null default '[]'::jsonb,
  catalog_query       jsonb,
  catalog_offset      int not null default 0 check (catalog_offset >= 0),
  catalog_updated_at  timestamptz,
  selected_program_id text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_ai_conversation_state_updated on public.ai_conversation_state (updated_at);

drop trigger if exists set_updated_at_ai_conversation_state on public.ai_conversation_state;
create trigger set_updated_at_ai_conversation_state
  before update on public.ai_conversation_state
  for each row execute function public.handle_updated_at();

alter table public.ai_conversation_state enable row level security;
revoke all on public.ai_conversation_state from anon, authenticated;
drop policy if exists "service_role_only_ai_conversation_state" on public.ai_conversation_state;
create policy "service_role_only_ai_conversation_state" on public.ai_conversation_state for all using (false);

-- 3) ai_requests ----------------------------------------------
create table if not exists public.ai_requests (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text,
  channel         text not null default 'chatwoot',
  mode            text not null check (mode in ('shadow', 'on')),
  message_len     int  not null,
  message_sha256  text not null,
  message_text    text,            -- only when AI_LOG_TEXT=true (customer text is personal data)
  language        text,
  intent          text,
  confidence      real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  entities        jsonb,
  action          text,
  defer_reason    text,
  handled         boolean not null default false,
  latency_ms      int,
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ai_requests_created  on public.ai_requests (created_at desc);
create index if not exists idx_ai_requests_conv     on public.ai_requests (conversation_id, created_at desc);
create index if not exists idx_ai_requests_defer    on public.ai_requests (defer_reason) where defer_reason is not null;

alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from anon, authenticated;
drop policy if exists "service_role_only_ai_requests" on public.ai_requests;
create policy "service_role_only_ai_requests" on public.ai_requests for all using (false);

comment on table public.ai_requests is
  'Understanding-layer log. Retain ~90 days (delete where created_at < now() - interval ''90 days'' via cron).';

commit;

-- Verify (read-only):
-- select count(*) from public.provinces;                                  -- expect 77
-- select id from public.provinces where 'อุดร' = any(aliases);            -- udon-thani
-- select relrowsecurity from pg_class where relname in ('provinces','ai_conversation_state','ai_requests');
