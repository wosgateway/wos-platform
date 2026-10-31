/** Shared lexical aliases only; these do not establish catalog membership. */
export const SELECTION_SERVICE_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['ກວດສຸຂະພາບ', 'ตรวจสุขภาพ'],
  ['ກວດເຂົ່າ', 'ตรวจเข่า'],
];

const aliases: ReadonlyArray<readonly [string, string]> = [
  ...SELECTION_SERVICE_ALIASES,
  ['ເລືອກ', 'เลือก'] as const,
].sort((a, b) => b[0].length - a[0].length);

/** Canonicalize selection wording without interpreting intent or querying services. */
export function normalizeSelectionInput(input: string): string {
  let result = input.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/gu, '');
  for (const [from, to] of aliases) result = result.replaceAll(from, to);
  return result;
}
