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
]);

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
];

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
 */
function buildSearchCandidates(query: string): string[] {
  const normalized = normalizeQuery(query);

  if (!normalized) {
    return [];
  }

  const candidates: string[] = [];

  const addCandidate = (value: string) => {
    const candidate = normalizeQuery(value);

    if (!candidate) return;
    if (candidate.length < 2) return;

    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  // 1. Full query after normalization.
  addCandidate(normalized);

  // 2. Remove obvious conversational words.
  const cleaned = removeStopWords(normalized);
  addCandidate(cleaned);

  // 3. Whitespace-separated terms.
  for (const token of cleaned.split(/\s+/)) {
    if (token.length >= 2) {
      addCandidate(token);
    }
  }

  // 4. Match known WOS domain terms contained inside Thai/English text.
  //
  // This handles Thai phrases without spaces, e.g.
  // "มีโปรแกรมอะไรสำหรับดูแลสุขภาพบ้าง"
  for (const term of DOMAIN_TERMS) {
    if (normalized.toLowerCase().includes(term.toLowerCase())) {
      addCandidate(term);
    }
  }

  return candidates.slice(0, 12);
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
export async function searchPrograms(
  query: string,
  limit = 5
): Promise<ProgramSearchResult[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 10);
  const locationAliases = detectLocation(query);

const candidates = Array.from(
  new Set([
    ...locationAliases,
    ...buildSearchCandidates(query),
  ])
).slice(0, 12);

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
      rawItems = await searchPackages(candidate, safeLimit);
    } catch (error) {
      console.error(
        '[WOS_AI_TOOL] searchPrograms candidate failed:',
        candidate,
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