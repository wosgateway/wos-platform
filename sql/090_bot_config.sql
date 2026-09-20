-- Migration 090: bot_config table
-- Stores dynamic facts (contact info, etc.) that the WOS AI chatbot
-- (src/app/api/chatwoot/webhook/route.ts) is allowed to state.
-- Editable from Supabase Studio without redeploying code.

create table if not exists public.bot_config (
  key text primary key,
  value text not null,
  label text,               -- human-readable description, shown in Studio only
  updated_at timestamptz not null default now()
);

alter table public.bot_config enable row level security;

-- Only the service role (used by createServiceClient() in server-side code)
-- can read/write. No anon/authenticated policy on purpose — never queried
-- from the browser.
create policy "service role full access"
  on public.bot_config
  for all
  to service_role
  using (true)
  with check (true);

-- Seed with the current correct contact info.
insert into public.bot_config (key, value, label) values
  ('contact_phone_th', '085-590-7666', 'โทรศัพท์ (ไทย)'),
  ('contact_phone_la', '+856 20 9872 4718', 'โทรศัพท์ (ลาว)'),
  ('contact_line_id', '@vlf9996z', 'LINE Official Account ID'),
  ('contact_line_url', 'https://line.me/ti/p/@vlf9996z', 'ลิงก์เพิ่มเพื่อน LINE'),
  ('contact_whatsapp_url', 'https://wa.me/66864522644', 'ลิงก์ WhatsApp'),
  ('contact_email', 'hello@wos.asia', 'อีเมลติดต่อ')
on conflict (key) do update set value = excluded.value, label = excluded.label;

-- To update any value later (no redeploy needed), e.g.:
-- update public.bot_config set value = 'new-value' where key = 'contact_email';
