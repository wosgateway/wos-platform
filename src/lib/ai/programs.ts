import {
  fetchActivePackages,
  fetchPackageById,
  searchPackages,
} from '@/lib/data';

/**
 * These objects are sent straight back to the model as tool results, so keep
 * them small: no image URLs, category/sub-category, or partner ids. The model
 * copies whatever it sees, and the prompt forbids showing internal ids.
 *
 * `id` stays on search results only because getProgramDetails needs it
 * (tool-guard.ts collects it from here).
 */
export type ProgramPartnerInfo = {
  name?: string;
  province?: string | null;
};

export type ProgramSearchResult = {
  id: string;
  title: string;
  description?: string | null;
  is_promotion?: boolean;
  original_price?: number | null;
  special_price?: number | null;
  duration?: string | null;
  duration_minutes?: number | null;
  partner?: ProgramPartnerInfo;
};

export type ProgramDetailsResult = Omit<ProgramSearchResult, 'id'>;

/** Drop null/undefined/empty-string fields so the model sees only real data. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === '') continue;
    out[key] = value;
  }
  return out as T;
}

/**
 * Words that are usually conversational/search noise rather than
 * meaningful package-search terms.
 *
 * Keep this list conservative. We do not want to accidentally remove
 * meaningful healthcare terms.
 */
const THAI_STOP_WORDS = new Set([
  'โปรแกรม',
  'บริการ',
  'มี',
  'ไหม',
  'อะไร',
  'อะไรบ้าง',
  'บ้าง',
  'ช่วย',
  'ขอ',
  'อยาก',
  'หา',
  'ต้องการ',
  'หน่อย',
  'ให้',
  'ได้',
  'หรือ',
  'และ',
  'ที่',
  'ไหน',
  'ไหนบ้าง',
  'สำหรับ',
  'เกี่ยวกับ',
  'แบบ',
  'เป็น',
  'คือ',
  'ของ',
  'ใน',
  'กับ',
  'ทาง',
  'ตอนนี้',
  'ครับ',
  'ค่ะ',
  'คะ',
  'ครับผม',
]);

const ENGLISH_STOP_WORDS = new Set([
  'program',
  'programs',
  'service',
  'services',
  'what',
  'which',
  'are',
  'is',
  'there',
  'any',
  'for',
  'the',
  'and',
  'or',
  'please',
  'can',
  'you',
  'show',
  'me',
  'available',
  'on',
  'to',
  'of',
  'in',
  'at',
  'by',
  'with',
  'from',
  'as',
  'be',
  'do',
  'does',
] );

/**
 * Useful WOS domain terms.
 *
 * These are fallback terms only. They are NOT treated as facts about
 * what programs exist. They simply help a broad natural-language query
 * reach searchPackages().
 */
const DOMAIN_TERMS = [
  'สุขภาพ',
  'ดูแลสุขภาพ',
  'ฟื้นฟู',
  'wellness',
  'healthcare',
  'clinic',
  'คลินิก',
  'medical',
  'การแพทย์',
  'spa',
  'สปา',
  'นวด',
  'ความงาม',
  'ผิว',
  'กายภาพ',
  'โยคะ',
  'yoga',
  'fitness',
  'ออกกำลังกาย',
  'โรงแรม',
  'hotel',
  'รีสอร์ท',
  'resort',
  'อาหาร',
  'healthy food',
  'transport',
  'รถรับส่ง',
  'trip',
  'ทริป',
];

/**
 * Lowercased lookup set for DOMAIN_TERMS, plus a couple of generic English
 * words that show up in AI-generated queries but are not in DOMAIN_TERMS
 * itself (e.g. "program"/"service" already get removed as stop words, so
 * they never reach this set).
 *
 * A "generic" term is one broad/category-level enough that it is likely to
 * appear as boilerplate copy inside many unrelated package *descriptions*
 * (e.g. a transport package's description mentioning "สุขภาพ" in a generic
 * marketing disclaimer). A generic term proves nothing about a specific
 * package on its own - see GENERIC_TERMS usage below in
 * buildSearchCandidates() and passesRelevanceGate().
 */
const GENERIC_TERMS = new Set(
  DOMAIN_TERMS.map((term) => term.toLowerCase())
);

/**
 * Unit/quantity/filler words that are technically "specific" (not in
 * DOMAIN_TERMS) but are just as unsafe as a generic term: they show up
 * inside almost every package's title or description regardless of what
 * the package actually is (durations are written as "3 วัน 2 คืน" on
 * nearly every tour/hotel/health package; "มนุษย์" is common vague
 * marketing filler). Left ungated, a token like "วัน" picked up from an
 * unrelated query (e.g. a trip to Mars) would independently match most of
 * the catalog. Treating these as generic routes them through the same
 * title/partner-name-only relevance gate as DOMAIN_TERMS, and drops them
 * outright whenever the query has other, real specific content.
 */
const NOISE_TERMS = new Set([
  'วัน', 'คืน', 'เดือน', 'ปี', 'ครั้ง', 'ท่าน', 'คน', 'บาท',
  'ชม', 'ชั่วโมง', 'นาที', 'มนุษย์',
  'day', 'days', 'night', 'nights', 'month', 'months', 'year', 'years',
  'time', 'times', 'person', 'people', 'baht', 'hour', 'hours', 'minute',
  'minutes',
]);

type SearchCandidate = {
  value: string;
  /**
   * True when this candidate is a broad/category term (see GENERIC_TERMS)
   * rather than a specific word taken directly from the query. Generic
   * candidates get two restrictions applied elsewhere in this file:
   *  1. buildSearchCandidates() drops them whenever a specific candidate is
   *     also available, so a generic term never rides along a specific
   *     search and dilutes it.
   *  2. passesRelevanceGate() only trusts a generic candidate's match when
   *     it lands in the program's title or partner name, not merely
   *     somewhere in the description.
   */
  generic: boolean;
};

/** Strip Thai tone marks only (ไม้เอก/โท/ตรี/จัตวา, U+0E48-U+0E4B).
 *
 * Mirrors strip_thai_tone_marks() in sql/122_thai_search_normalize.sql so
 * the relevance gate below matches the same way the RPC does.
 */
function stripThaiToneMarks(value: string): string {
  return value.replace(/[\u0E48-\u0E4B]/g, '');
}

function normalizeForMatch(value: string): string {
  return stripThaiToneMarks(value).toLowerCase();
}

function containsTerm(
  haystack: string | null | undefined,
  term: string
): boolean {
  if (!haystack || !term) return false;
  return normalizeForMatch(haystack).includes(normalizeForMatch(term));
}

/**
 * Normalize a user/AI-generated search query.
 */
function normalizeQuery(query: string): string {
  return query
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove obvious conversational noise while keeping meaningful terms.
 */
function removeStopWords(value: string): string {
  let result = value;

  for (const word of THAI_STOP_WORDS) {
    result = result.replaceAll(word, ' ');
  }

  for (const word of ENGLISH_STOP_WORDS) {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi');
    result = result.replace(pattern, ' ');
  }

  return result.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract useful search candidates from natural language.
 *
 * We deliberately keep the candidate count small because every candidate
 * can result in a database search.
 *
 * Layer 1 of the search-relevance fix: a generic/category-level term (see
 * GENERIC_TERMS) is only allowed to act as a search candidate when the
 * query has no more specific content at all - i.e. a genuine broad browse
 * request such as "มีโปรแกรมดูแลสุขภาพอะไรบ้าง". The moment there is a
 * specific candidate too (whatever the query is actually about), generic
 * candidates are dropped so they can never ride along and independently
 * pull in unrelated results.
 */
function buildSearchCandidates(query: string): SearchCandidate[] {
  const normalized = normalizeQuery(query);

  if (!normalized) {
    return [];
  }

  const specific: SearchCandidate[] = [];
  const generic: SearchCandidate[] = [];

  const addCandidate = (value: string, isGeneric: boolean) => {
    const candidate = normalizeQuery(value);

    if (!candidate) return;
    if (candidate.length < 2) return;

    const bucket = isGeneric ? generic : specific;
    const already =
      specific.some((c) => c.value === candidate) ||
      generic.some((c) => c.value === candidate);

    if (!already) {
      bucket.push({ value: candidate, generic: isGeneric });
    }
  };

  const isGenericTerm = (value: string) =>
    GENERIC_TERMS.has(value.toLowerCase()) ||
    NOISE_TERMS.has(value.toLowerCase());

  // 1. Full query is only safe when it contains a known WOS domain term.
// Long natural-language queries generated by the AI can otherwise be
// interpreted by the RPC's fuzzy search as unrelated catalog matches.
  const hasDomainTerm = DOMAIN_TERMS.some((term) =>
    normalized.toLowerCase().includes(term.toLowerCase())
  );

  if (hasDomainTerm) {
    addCandidate(normalized, isGenericTerm(normalized));
  }

  // 2. Remove obvious conversational words.
  const cleaned = removeStopWords(normalized);

  // Only keep the cleaned phrase when it is short enough to behave like
  // an actual service name rather than an arbitrary natural-language sentence.
  const cleanedTokenCount = cleaned.split(/\s+/).filter(Boolean).length;

  if (cleanedTokenCount <= 3 || hasDomainTerm) {
    addCandidate(cleaned, isGenericTerm(cleaned));
  }

  // 3. Whitespace-separated terms. A bare number ("7") is never a useful
  // search candidate on its own, so it's skipped entirely rather than
  // routed through the generic/specific split.
  for (const token of cleaned.split(/\s+/)) {
    if (token.length >= 2 && !/^\d+$/.test(token)) {
      addCandidate(token, isGenericTerm(token));
    }
  }

  // 4. Match known WOS domain terms contained inside Thai/English text.
  //
  // This handles Thai phrases without spaces, e.g.
  // "มีโปรแกรมอะไรสำหรับดูแลสุขภาพบ้าง"
  // Every candidate from this step is by definition generic.
  for (const term of DOMAIN_TERMS) {
    if (normalized.toLowerCase().includes(term.toLowerCase())) {
      addCandidate(term, true);
    }
  }

  // Layer 1 gate: generic terms don't get to be independent candidates
  // once the query has any specific content of its own.
  const result = specific.length > 0 ? specific : [...specific, ...generic];

  return result.slice(0, 12);
}

function mapSearchResult(
  item: Awaited<ReturnType<typeof searchPackages>>[number]
): ProgramSearchResult {
  // Supabase returns a many-to-one embed (packages -> partners) as a single
  // object, not an array; handle both shapes.
  const rawPartner = item.partners as unknown;
  const partner = (Array.isArray(rawPartner) ? rawPartner[0] : rawPartner) as
    | {
        id?: string;
        name?: string;
        category?: string;
        province?: string | null;
      }
    | undefined;

  return compact({
    id: String(item.id ?? ''),
    title: String(item.title ?? ''),
    description: item.description == null ? null : String(item.description),
    is_promotion: item.is_promotion ? true : undefined,
    original_price:
      item.original_price == null ? null : Number(item.original_price),
    special_price:
      item.special_price == null ? null : Number(item.special_price),
    duration: item.duration == null ? null : String(item.duration),
    duration_minutes:
      item.duration_minutes == null ? null : Number(item.duration_minutes),
    partner: partner
      ? compact({
          name: String(partner.name ?? ''),
          province:
            partner.province == null ? null : String(partner.province),
        })
      : undefined,
  }) as ProgramSearchResult;
}
// Full list of Thailand's 77 provinces so `detectLocation()` can filter by
// any province the customer asks about, not only the 4 that happened to be
// hardcoded before. Bangkok gets its own alias group because it has several
// common written forms; every other province is matched by its one official
// Thai name (normalizeLocation() below also strips an optional "จังหวัด"
// prefix, so "จังหวัดเชียงใหม่" and "เชียงใหม่" match the same alias).
const BANGKOK_ALIASES = ['กรุงเทพ', 'กรุงเทพฯ', 'กรุงเทพมหานคร'];

const OTHER_PROVINCES = [
  'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี',
  'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย',
  'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม',
  'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน',
  'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี',
  'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร',
  'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต', 'มหาสารคาม',
  'มุกดาหาร', 'แม่ฮ่องสอน', 'ยะลา', 'ยโสธร', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง',
  'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร',
  'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว',
  'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์',
  'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์',
  'อุทัยธานี', 'อุบลราชธานี',
];

const LOCATION_ALIASES: string[][] = [
  BANGKOK_ALIASES,
  ...OTHER_PROVINCES.map((province) => [province]),
];

function normalizeLocation(value: string): string {
  return normalizeQuery(value)
    .replace(/จังหวัด/g, '')
    .replace(/กรุงเทพมหานคร/g, 'กรุงเทพ')
    .replace(/กรุงเทพฯ/g, 'กรุงเทพ')
    .trim();
}

function detectLocation(query: string): string[] {
  const normalized = normalizeLocation(query);

  for (const aliases of LOCATION_ALIASES) {
    if (
      aliases.some((alias) =>
        normalized.includes(normalizeLocation(alias))
      )
    ) {
      return aliases;
    }
  }

  return [];
}

/**
 * Remove the matched province's own alias text from the query before
 * candidate generation.
 *
 * Without this, a query like "ท่องเที่ยวที่อุดรธานี" leaves "อุดรธานี"
 * sitting in the cleaned/full-query candidates as ordinary "specific"
 * text, which the relevance gate trusts unconditionally (see
 * passesRelevanceGate). A province name matches on the `province` column
 * for every partner located there, so trusting it as a free specific
 * candidate is exactly the generic-term leak Layer 1/2 exist to prevent -
 * it would pull in every package in that province regardless of the
 * service actually being asked about. Stripping the location text first
 * means detectLocation()'s aliases are only ever used the one intended
 * way: as the post-search province filter, or (see searchPrograms) as an
 * explicit standalone candidate for the narrow case where the query is
 * genuinely just "what's available in <province>" with no other content.
 */
function stripLocationMentions(query: string, aliases: string[]): string {
  let result = query;

  for (const alias of aliases) {
    result = result.replaceAll(alias, ' ');
  }

  // Bangkok's aliases overlap ("กรุงเทพ" is a prefix of "กรุงเทพฯ" and
  // "กรุงเทพมหานคร"), and the query may also carry the "จังหวัด" prefix
  // normalizeLocation() strips - remove those forms too so no fragment of
  // the location name survives into the candidate text.
  result = result
    .replaceAll('จังหวัด', ' ')
    .replaceAll('กรุงเทพมหานคร', ' ')
    .replaceAll('กรุงเทพฯ', ' ')
    .replaceAll('กรุงเทพ', ' ');

  return result;
}

/**
 * Layer 2 of the search-relevance fix: the relevance gate.
 *
 * search_packages_thai() matches a candidate against title, description,
 * partner name AND partner province, so a candidate is technically always
 * "found somewhere" in a row it returns. That's fine for a specific term
 * (a specific word picked out of a Thai/English query, like a body part or
 * treatment name, is not going to show up as unrelated boilerplate). It is
 * not fine for a generic/category term - those routinely show up inside a
 * package's *description* as generic marketing copy regardless of what the
 * package actually is (e.g. a transport package's description mentioning
 * "สุขภาพ" in passing).
 *
 * So: a specific candidate's match must still be literally verified
 * (title, description, or partner name) - it is just allowed to count a
 * description hit, since a specific term is not going to show up there as
 * generic boilerplate. A generic candidate's match is only trusted when it
 * actually names the program - i.e. it shows up in the title or the
 * partner name, not only buried in the description or picked up via the
 * province field.
 *
 * The literal check on specific candidates matters because
 * search_packages_thai() can return a row via fuzzy/trigram matching even
 * when the candidate text never actually appears anywhere in that row -
 * e.g. "โปรแกรมสำหรับมนุษย์บนดาวอังคาร" (no real space-delimited words for
 * the tokenizer to work with) came back as one long "specific" candidate
 * and the RPC's fuzzy matching pulled in an unrelated Udon Hotel package.
 * Blindly trusting "the RPC returned it" for any candidate not on
 * GENERIC_TERMS/NOISE_TERMS let that through. Requiring our own literal
 * (tone-mark/case-insensitive) substring check closes that without
 * needing changes to the RPC itself.
 */
function passesRelevanceGate(
  candidate: SearchCandidate,
  mapped: ProgramSearchResult
): boolean {
  if (candidate.generic) {
    return (
      containsTerm(mapped.title, candidate.value) ||
      containsTerm(mapped.partner?.name, candidate.value)
    );
  }

  return (
    containsTerm(mapped.title, candidate.value) ||
    containsTerm(mapped.description, candidate.value) ||
    containsTerm(mapped.partner?.name, candidate.value)
  );
}

export async function searchPrograms(
  query: string,
  limit = 5
): Promise<ProgramSearchResult[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 10);
  const locationAliases = detectLocation(query);

  // Build service candidates from the query with the matched province's
  // own text removed, so a location word never sits in the cleaned/full
  // query text and rides through the relevance gate as ordinary
  // "specific" content (see stripLocationMentions()).
  const serviceQuery =
    locationAliases.length > 0
      ? stripLocationMentions(query, locationAliases)
      : query;

  const seen = new Set<string>();
  const candidates: SearchCandidate[] = [];

  const pushCandidate = (candidate: SearchCandidate) => {
    if (!seen.has(candidate.value)) {
      seen.add(candidate.value);
      candidates.push(candidate);
    }
  };

  const serviceCandidates = buildSearchCandidates(serviceQuery);

  if (locationAliases.length > 0 && serviceCandidates.length === 0) {
    // The query is genuinely just "what's available in <province>" -
    // nothing else to search on, so the province itself is the only
    // useful candidate. It's still constrained by the exact
    // province-match filter below, and by passesRelevanceGate() acting
    // as a no-op for a non-generic candidate.
    pushCandidate({ value: locationAliases[0], generic: false });
  }

  for (const candidate of serviceCandidates) {
    pushCandidate(candidate);
  }

  candidates.splice(12);

  if (candidates.length === 0) {
    return [];
  }

  const resultMap = new Map<string, ProgramSearchResult>();

  /**
   * Run candidate searches in order.
   *
   * We intentionally stop once enough results are found. This keeps
   * broad natural-language searches reasonably cheap.
   */
  for (const candidate of candidates) {
    let rawItems: Awaited<ReturnType<typeof searchPackages>> = [];

    try {
      rawItems = await searchPackages(candidate.value, safeLimit);
    } catch (error) {
      console.error(
        '[WOS_AI_TOOL] searchPrograms candidate failed:',
        candidate.value,
        error
      );
      continue;
    }

    for (const item of rawItems) {
  const mapped = mapSearchResult(item);

  if (!mapped.id) {
    continue;
  }

  if (
    locationAliases.length > 0 &&
    !locationAliases.some(
      (alias) =>
        normalizeLocation(alias) ===
        normalizeLocation(mapped.partner?.province ?? '')
    )
  ) {
    continue;
  }

  // Layer 2 relevance gate: a generic/category candidate must actually
  // name the program (title or partner name), not just have matched
  // somewhere inside a boilerplate description.
  if (!passesRelevanceGate(candidate, mapped)) {
    continue;
  }

  resultMap.set(mapped.id, mapped);
}

    if (resultMap.size >= safeLimit) {
      break;
    }
  }

  // Only browse the active catalog for explicit broad-list requests.
  // A targeted query with no match must stay empty so the AI does not
  // receive unrelated programs and accidentally present them as matches.
  const normalizedQuery = normalizeQuery(query).toLowerCase();
  const isBroadBrowseQuery =
    normalizedQuery.includes('มีโปรแกรมอะไรบ้าง') ||
    normalizedQuery.includes('มีบริการอะไรบ้าง') ||
    normalizedQuery.includes('แนะนำโปรแกรม') ||
    normalizedQuery.includes('แนะนำบริการ') ||
    normalizedQuery.includes('รายการโปรแกรม') ||
    normalizedQuery.includes('รายการบริการ') ||
    normalizedQuery.includes('what programs') ||
    normalizedQuery.includes('what services') ||
    normalizedQuery.includes('show me programs') ||
    normalizedQuery.includes('show me services') ||
    normalizedQuery.includes('available programs') ||
    normalizedQuery.includes('available services');

  if (resultMap.size === 0 && isBroadBrowseQuery) {
    try {
      const activeItems = await fetchActivePackages(safeLimit);

      for (const item of activeItems) {
        const mapped = mapSearchResult(item);

        if (mapped.id) {
          resultMap.set(mapped.id, mapped);
        }
      }
    } catch (error) {
      console.error(
        '[WOS_AI_TOOL] fetchActivePackages fallback failed:',
        error
      );
    }
  }

  return Array.from(resultMap.values()).slice(0, safeLimit);
}

export async function getProgramDetails(
  programId: string
): Promise<ProgramDetailsResult | null> {
  const id = programId.trim();

  if (!id) {
    return null;
  }

  try {
    const item = await fetchPackageById(id);
    const partner = item.partners;

    /**
     * fetchPackageById() already guarantees:
     * - package status = published
     * - package is_active = true
     *
     * We additionally enforce partner status here because this AI-facing
     * function must never return a program belonging to an inactive partner.
     */
    if (!partner || partner.status !== 'active') {
      return null;
    }

    return compact({
      title: String(item.title ?? ''),
      description:
        item.description == null ? null : String(item.description),
      is_promotion: item.is_promotion ? true : undefined,
      original_price:
        item.original_price == null ? null : Number(item.original_price),
      special_price:
        item.special_price == null ? null : Number(item.special_price),
      duration: item.duration == null ? null : String(item.duration),
      duration_minutes:
        item.duration_minutes == null ? null : Number(item.duration_minutes),
      partner: compact({
        name: String(partner.name ?? ''),
        province:
          partner.province == null ? null : String(partner.province),
      }),
    }) as ProgramDetailsResult;
  } catch (error) {
    console.error(
      '[WOS_AI_TOOL] getProgramDetails failed:',
      programId,
      error
    );

    return null;
  }
}