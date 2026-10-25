import { getSymptomSearchAliases } from './symptom-intent';

/** Lexical aliases only. Catalog decisions stay in shared preparation/orchestration. */
export const CATALOG_PROVINCE_ALIASES: Record<string, string[]> = {
  'อุดรธานี': ['อุดร', 'อຸດອນ', 'ອຸດອນ', 'ອຸດອນທານີ', 'ອຸດອນທານິ', 'ອຸດຮ', 'ອຸດຣ', 'Udon Thani'],
  'หนองคาย': ['ໜອງຄາຍ', 'ຫນອງຄາຍ', 'ໜອງຄາຽ', 'ຫນອງຄາຽ', 'Nong Khai'],
};
const SERVICE_ALIASES: Array<[string, string]> = [
  ['ກວດສຸຂະພາບ', 'ตรวจสุขภาพ'], ['ກວດເຂົ່າ', 'ตรวจเข่า'],
];
// Relocated from the legacy core normalizer, plus the question wrappers needed
// for service search, discovery and coverage. This is not a service inventory.
const SURFACE_ALIASES: Array<[string, string]> = [
  ...SERVICE_ALIASES,
  // Lao selection verb -> the canonical Thai verb, so Lao selections share the Thai selection syntax.
  ['ເລືອກ', 'เลือก'],
  ['ວຽງຈັນ', 'เวียงจันทน์'], ['ໂປຣແກຣມ', 'โปรแกรม'], ['ໂຄງການ', 'โปรแกรม'],
  ['ບໍລິການ', 'บริการ'], ['ຮັກສາ', 'รักษา'], ['ໂຮງໝໍ', 'โรงพยาบาล'],
  ['ລົດ', 'รถ'], ['ໂຮງແຮມ', 'โรงแรม'], ['ທ່ຽວ', 'ทริป'],
  ['ຫຍັງແດ່', 'อะไรบ้าง'], ['ໃດແດ່', 'ไหนบ้าง'], ['ຕອນນີ້', 'ตอนนี้'],
  ['ຈັງຫວັດ', 'จังหวัด'], ['ແຂວງ', 'จังหวัด'], ['ຈັກ', 'กี่'],
  ['ຫຍັງ', 'อะไร'], ['ໃດ', 'ไหน'], ['ແດ່', 'บ้าง'], ['ຢູ່', 'ใน'], ['ໃນ', 'ใน'], ['ມີ', 'มี'], ['ບໍ', 'ไหม'],
];
const aliases: Array<[string,string]> = [
  ...Object.entries(CATALOG_PROVINCE_ALIASES).flatMap(([canonical, names]) =>
    names.filter(name => !/^[\u0e00-\u0e7f]+$/u.test(name)).map(name => [name, canonical] as [string,string])),
  ...SURFACE_ALIASES,
].sort((a,b) => b[0].length-a[0].length);
export function normalizeCatalogInput(input: string): string {
  let result=input.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/gu,'');
  for(const [from,to] of aliases) {
    result=/^[a-z ]+$/i.test(from)
      ? result.replace(new RegExp('\\b'+from+'\\b','gi'),to)
      : result.replaceAll(from,to);
  }
  return result;
}
/** Known service entities use the same aliases as normalization. No fuzzy invention. */
export function canonicalCatalogService(input: string): string | null {
  const normalized=normalizeCatalogInput(input);
  return getSymptomSearchAliases(normalized)[0]
    ?? SERVICE_ALIASES.map(([,canonical])=>canonical).find(service=>normalized.includes(service))
    ?? null;
}
export function hasProvinceCoverageWording(input: string): boolean {
  return /จังหวัด\s*(?:ไหน|อะไร)|กี่\s*จังหวัด|(?:which|what|how many)\s+provinces/iu.test(normalizeCatalogInput(input));
}

/** Explicit location wording left unresolved must never remove a search constraint. */
export function hasCatalogLocationWording(input: string): boolean {
  return /จังหวัด|ใน\s*[\u0e80-\u0eff]/u.test(normalizeCatalogInput(input));
}

export function hasCatalogDiscoveryWording(input: string): boolean {
  let text = normalizeCatalogInput(input);
  if (canonicalCatalogService(text)) return false;
  // Only an otherwise empty browse question is deterministic discovery.
  // Unrecognized service wording must remain available to LLM understanding.
  const places = Object.entries(CATALOG_PROVINCE_ALIASES)
    .flatMap(([canonical, names]) => [canonical, ...names]).sort((a, b) => b.length - a.length);
  for (const place of places) text = text.replaceAll(place, '');
  text = text.replace(/จังหวัด|\s+/gu, '');
  return /^(?:มี)?(?:โปรแกรม|บริการ)(?:อะไร|มีอะไร)(?:บ้าง)?$/u.test(text);
}
