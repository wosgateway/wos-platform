// src/lib/province.ts
//
// `partners.province` is free-text TEXT with no CHECK constraint, so the
// same real-world province can be entered in more than one spelling.
// Known case so far: "กรุงเทพฯ" (with ไม้ยมก) vs "กรุงเทพ" (without) —
// same place, two different strings. Left un-normalized, any dropdown
// built directly from `partners.map(p => p.province)` would show these
// as two separate options even though picking either one should mean
// "Bangkok".
//
// normalizeProvince() is the single place that collapses known
// variant spellings into one canonical form. Anything deriving a
// province list or filtering by province (admin PackagesManager,
// customer-facing hotel step) should go through this rather than
// using partner.province directly, so a new variant only needs to be
// added here once.

// canonical spelling -> other spellings seen in the data that should
// collapse into it. Add new rows here as more mismatches turn up.
const PROVINCE_ALIASES: Record<string, string[]> = {
  กรุงเทพฯ: ['กรุงเทพ', 'กรุงเทพมหานคร', 'กทม.', 'กทม'],
};

const ALIAS_TO_CANONICAL: Map<string, string> = new Map();
for (const [canonical, aliases] of Object.entries(PROVINCE_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(alias.trim(), canonical);
  }
}

// Trims whitespace and maps known alias spellings to their canonical
// form. Returns null for empty/whitespace-only/missing values so
// callers can filter those out of dropdowns instead of showing a
// blank option.
export function normalizeProvince(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  return ALIAS_TO_CANONICAL.get(trimmed) ?? trimmed;
}

// Distinct, normalized, Thai-sorted province list derived from a set
// of objects that carry a `province` field (partners, or packages
// joined with partners). Use this instead of hand-rolling
// `Array.from(new Set(...))` so every dropdown in the app dedupes the
// same way.
export function distinctProvinces(items: Array<{ province?: string | null }>): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const p = normalizeProvince(item.province);
    if (p) set.add(p);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
}
