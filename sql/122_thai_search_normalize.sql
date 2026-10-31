-- 122_thai_search_normalize.sql
--
-- Thai search normalization: strip tone marks (ไม้เอก/โท/ตรี/จัตวา,
-- U+0E48-U+0E4B) only — NOT vowel signs — so a search term that is
-- missing/has a different tone mark than the stored title can still
-- match (e.g. AI-generated query "ตรวจเขา" vs stored title "ตรวจเข่า").
--
-- Deliberately narrow range: U+0E34-U+0E3A (สระ อิ อี อึ อื อุ อู, พินทุ)
-- is NOT stripped because those carry real phonetic/semantic meaning
-- in Thai (e.g. สิว "acne" vs ผิว "skin" would otherwise both collapse
-- toward meaningless 2-letter fragments). See conversation notes for the
-- collision check performed against the live `packages` table before
-- this migration was written (0 collisions found on tone-mark-only
-- normalization).
--
-- IMMUTABLE so it can be used in a functional/generated index later if
-- needed; for now it is only used at query time.
create or replace function strip_thai_tone_marks(input text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(input, '[\u0E48-\u0E4B]', '', 'g')
$$;

comment on function strip_thai_tone_marks(text) is
  'Strips Thai tone marks only (ไม้เอก/โท/ตรี/จัตวา, U+0E48-U+0E4B) for tone-mark-tolerant search matching. Does not touch vowel signs.';

-- ---------------------------------------------------------------------
-- Replaces the 4-way ILIKE search previously done client-side (title /
-- description / partner name / partner province) with a single
-- server-side function that applies strip_thai_tone_marks() to both
-- sides of the comparison. Same filters as before: published, active,
-- partner active.
-- ---------------------------------------------------------------------
create or replace function search_packages_thai(
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
$$;

comment on function search_packages_thai(text, int) is
  'Tone-mark-tolerant search across packages.title/description and partners.name/province. Used by searchPackages() in src/lib/data.ts instead of 4 separate ILIKE queries.';
