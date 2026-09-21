import {
  fetchActivePackages,
  fetchPackageById,
  searchPackages,
} from '@/lib/data';

export type ProgramSearchResult = {
  id: string;
  title: string;
  description?: string | null;
  image_url?: string | null;
  sub_category?: string | null;
  is_promotion?: boolean;
  original_price?: number | null;
  special_price?: number | null;
  duration?: string | null;
  duration_minutes?: number | null;
  partner_id?: string;
  partner?: {
    id?: string;
    name?: string;
    category?: string;
    province?: string | null;
  };
};

export type ProgramDetailsResult = {
  id: string;
  title: string;
  description?: string | null;
  image_url?: string | null;
  sub_category?: string | null;
  is_promotion?: boolean;
  original_price?: number | null;
  special_price?: number | null;
  duration?: string | null;
  duration_minutes?: number | null;
  partner_id?: string;
  partner?: {
    id?: string;
    name?: string;
    category?: string;
    province?: string | null;
  };
};

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

  return {
    id: String(item.id ?? ''),
    title: String(item.title ?? ''),
    description:
      item.description == null ? null : String(item.description),
    image_url:
      item.image_url == null ? null : String(item.image_url),
    sub_category:
      item.sub_category == null ? null : String(item.sub_category),
    is_promotion: Boolean(item.is_promotion),

original_price:
  item.original_price == null
    ? null
    : Number(item.original_price),

special_price:
  item.special_price == null
    ? null
    : Number(item.special_price),

duration:
  item.duration == null
    ? null
    : String(item.duration),

duration_minutes:
  item.duration_minutes == null
    ? null
    : Number(item.duration_minutes),

partner_id:
      item.partner_id == null ? undefined : String(item.partner_id),
    partner: partner
      ? {
          id: String(partner.id ?? ''),
          name: String(partner.name ?? ''),
          category: String(partner.category ?? ''),
          province:
            partner.province == null ? null : String(partner.province),
        }
      : undefined,
  };
}

export async function searchPrograms(
  query: string,
  limit = 5
): Promise<ProgramSearchResult[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 10);
  const candidates = buildSearchCandidates(query);

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

      if (mapped.id) {
        resultMap.set(mapped.id, mapped);
      }
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

    return {
      id: String(item.id ?? ''),
      title: String(item.title ?? ''),
      description:
        item.description == null ? null : String(item.description),
      image_url:
        item.image_url == null ? null : String(item.image_url),
      sub_category:
        item.sub_category == null ? null : String(item.sub_category),
      is_promotion: Boolean(item.is_promotion),

original_price:
  item.original_price == null
    ? null
    : Number(item.original_price),

special_price:
  item.special_price == null
    ? null
    : Number(item.special_price),

duration:
  item.duration == null
    ? null
    : String(item.duration),

duration_minutes:
  item.duration_minutes == null
    ? null
    : Number(item.duration_minutes),

partner_id:
  item.partner_id == null ? undefined : String(item.partner_id),
      partner: {
        id: String(partner.id ?? ''),
        name: String(partner.name ?? ''),
        category: String(partner.category ?? ''),
        province:
          partner.province == null ? null : String(partner.province),
      },
    };
  } catch (error) {
    console.error(
      '[WOS_AI_TOOL] getProgramDetails failed:',
      programId,
      error
    );

    return null;
  }
}