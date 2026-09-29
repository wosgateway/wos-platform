/**
 * Conservative customer-symptom -> catalog-language bridges.
 *
 * These are service-intent hints, not medical diagnoses. Keep the map small
 * and explicit so a symptom cannot broaden into an unrelated catalog search.
 */
const SYMPTOM_SEARCH_ALIASES: Array<[string, string]> = [
  ['ปวดเข่า', 'ตรวจเข่า'],
  ['เจ็บเข่า', 'ตรวจเข่า'],
  ['ปวดข้อเข่า', 'ตรวจเข่า'],
  ['เจ็บข้อเข่า', 'ตรวจเข่า'],
  ['เข่าปวด', 'ตรวจเข่า'],
];

export function getSymptomSearchAliases(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  const aliases: string[] = [];

  for (const [source, target] of SYMPTOM_SEARCH_ALIASES) {
    if (normalized.includes(source) && !aliases.includes(target)) {
      aliases.push(target);
    }
  }

  return aliases;
}
