// Province resolution against the canonical `provinces` table.
// Pure functions: the loader lives in state.ts so this file stays testable.

export interface ProvinceRecord {
  id: string;
  name_th: string;
  name_en: string | null;
  name_lo: string | null;
  aliases: string[];
}

/** Collapse spelling variants: spaces, "จังหวัด"/"จ."/"ແຂວງ" prefix, ฯ, มหานคร, case. */
export function normalizeProvinceText(input: string): string {
  return input
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\u200b-\u200d\ufeff]+/g, '')
    .replace(/^(?:จังหวัด|จ\.|ແຂວງ)/u, '')
    .replace(/province$/u, '')
    .replace(/ฯ/g, '')
    .replace(/มหานคร/g, '');
}

function namesOf(p: ProvinceRecord): string[] {
  return [p.name_th, p.name_en, p.name_lo, ...p.aliases].filter((x): x is string => !!x && x.trim().length > 0);
}

/** Exact (normalized) match of a province string, e.g. what the model extracted. */
export function matchProvince(raw: string | null, provinces: ProvinceRecord[]): ProvinceRecord | null {
  if (!raw) return null;
  const q = normalizeProvinceText(raw);
  if (!q) return null;
  for (const p of provinces) {
    if (namesOf(p).some((n) => normalizeProvinceText(n) === q)) return p;
  }
  return null;
}

const MARKER_PREFIXES = ['จังหวัด', 'จ.', 'ແຂວງ'];

/**
 * Deterministic cross-check: find a province named inside the raw customer text.
 * Short aliases (<4 chars after normalizing, e.g. "เลย" "ตาก") are ambiguous with ordinary
 * words, so they only count when written with an explicit marker ("จังหวัดเลย", "จ.ตาก").
 */
export function detectProvinceInText(text: string, provinces: ProvinceRecord[]): ProvinceRecord | null {
  const flat = text.normalize('NFC').toLowerCase().replace(/[\s\u200b-\u200d\ufeff]+/g, '');
  const normText = normalizeProvinceText(text);
  let best: { p: ProvinceRecord; len: number } | null = null;
  for (const p of provinces) {
    for (const name of namesOf(p)) {
      const n = normalizeProvinceText(name);
      if (!n) continue;
      let hit = false;
      if ([...n].length >= 4) hit = normText.includes(n) || flat.includes(n);
      else {
        const nameFlat = name.normalize('NFC').toLowerCase().replace(/\s+/g, '');
        hit = MARKER_PREFIXES.some((m) => flat.includes(m + nameFlat));
      }
      if (hit && (!best || n.length > best.len)) best = { p, len: n.length };
    }
  }
  return best?.p ?? null;
}

/** Map catalog province strings (partners.province free text) to canonical ids. */
export function coveredProvinceIds(catalogProvinceNames: string[], provinces: ProvinceRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const name of catalogProvinceNames) {
    const p = matchProvince(name, provinces);
    if (p) ids.add(p.id);
  }
  return ids;
}
