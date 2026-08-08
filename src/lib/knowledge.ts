// src/lib/knowledge.ts
// Metadata for the "Knowledge Center" articles shown on the homepage
// (replacing the old HowItWorks 3-step block, which duplicated JourneyTimeline)
// and on /knowledge, /knowledge/[slug]. Icons live here (not translatable);
// all text content lives in messages/*.json under `home.knowledge` (homepage
// cards, featured slugs only) and `knowledge.articles.<slug>` (full article
// body, all 20 slugs).
//
// UPDATED: 20 articles now each have their own dedicated illustration
// (see /public/images/knowledge/). Previously several slugs shared one of
// ~9 theme SVGs; that fallback sharing is gone except for
// `how-many-days-stay`, which still shares travel-vientiane-udon.svg with
// `travel-vientiane-to-udon` since no dedicated image exists for it yet.
//
// Spare file not currently referenced by any slug: telemedicine-follow-up.svg
// (kept in /public/images/knowledge/ for a possible future "remote follow-up
// consultation" article).

export type KnowledgeSlug =
  // original 3
  | 'lao-cross-border-treatment'
  | 'insurance-coverage'
  | 'clinic-vs-hospital'
  // documents & appointments
  | 'documents-checklist'
  | 'appointment-before-travel'
  // hospital selection
  | 'private-vs-public-hospital'
  | 'cosmetic-surgery-hospital-or-clinic'
  | 'choose-hospital-for-condition'
  // budget
  | 'health-checkup-budget'
  // travel & logistics
  | 'how-many-days-stay'
  | 'travel-vientiane-to-udon'
  // medical/wellness general info
  | 'mri-vs-ct-scan'
  | 'anti-aging-basics'
  | 'stem-cell-basics'
  | 'iv-drip-vitamin'
  // payment
  | 'qr-payment'
  // aftercare
  | 'post-surgery-recovery'
  | 'symptoms-after-returning'
  // overview
  | 'faq-lao-patients'
  | 'beginner-guide-lao-patients';

export interface KnowledgeMeta {
  slug: KnowledgeSlug;
  icon: string;
  image: string;
}

// Slugs shown as cards on the homepage KnowledgeCenter block. Keep this at 3
// so the homepage doesn't get cluttered — the full set renders at /knowledge.
export const FEATURED_KNOWLEDGE_SLUGS: KnowledgeSlug[] = [
  'lao-cross-border-treatment',
  'insurance-coverage',
  'clinic-vs-hospital',
];

export const KNOWLEDGE_ARTICLES: KnowledgeMeta[] = [
  {
    slug: 'lao-cross-border-treatment',
    icon: '📄',
    image: '/images/knowledge/lao-cross-border-treatment.svg',
  },
  {
    slug: 'insurance-coverage',
    icon: '🛡️',
    image: '/images/knowledge/insurance-coverage.svg',
  },
  {
    slug: 'clinic-vs-hospital',
    icon: '🏥',
    image: '/images/knowledge/clinic-vs-hospital.svg',
  },
  {
    slug: 'documents-checklist',
    icon: '📋',
    image: '/images/knowledge/eligibility-lao-patients.svg',
  },
  {
    slug: 'appointment-before-travel',
    icon: '📅',
    image: '/images/knowledge/advance-appointment-booking.svg',
  },
  {
    slug: 'private-vs-public-hospital',
    icon: '🏨',
    image: '/images/knowledge/private-vs-public-hospital.svg',
  },
  {
    slug: 'cosmetic-surgery-hospital-or-clinic',
    icon: '💉',
    image: '/images/knowledge/cosmetic-surgery-hospital-or-clinic.svg',
  },
  {
    slug: 'choose-hospital-for-condition',
    icon: '🔍',
    image: '/images/knowledge/choose-hospital-by-disease.svg',
  },
  {
    slug: 'health-checkup-budget',
    icon: '💰',
    image: '/images/knowledge/budget-checkup.svg',
  },
  {
    slug: 'how-many-days-stay',
    icon: '🗓️',
    image: '/images/knowledge/travel-vientiane-udon.svg',
  },
  {
    slug: 'travel-vientiane-to-udon',
    icon: '🚐',
    image: '/images/knowledge/travel-vientiane-udon.svg',
  },
  {
    slug: 'mri-vs-ct-scan',
    icon: '🩻',
    image: '/images/knowledge/medical-imaging.svg',
  },
  {
    slug: 'anti-aging-basics',
    icon: '✨',
    image: '/images/knowledge/anti-aging-medicine.svg',
  },
  {
    slug: 'stem-cell-basics',
    icon: '🧬',
    image: '/images/knowledge/stem-cell-therapy.svg',
  },
  {
    slug: 'iv-drip-vitamin',
    icon: '💧',
    image: '/images/knowledge/aesthetic-treatments.svg',
  },
  {
    slug: 'qr-payment',
    icon: '📱',
    image: '/images/knowledge/payment-qr.svg',
  },
  {
    slug: 'post-surgery-recovery',
    icon: '🛏️',
    image: '/images/knowledge/post-surgery-recovery-center.svg',
  },
  {
    slug: 'symptoms-after-returning',
    icon: '⚠️',
    image: '/images/knowledge/aftercare-recovery.svg',
  },
  {
    slug: 'faq-lao-patients',
    icon: '❓',
    image: '/images/knowledge/faq-lao-patients.svg',
  },
  {
    slug: 'beginner-guide-lao-patients',
    icon: '📘',
    image: '/images/knowledge/complete-guide.svg',
  },
];

export function getKnowledgeMeta(slug: string): KnowledgeMeta | null {
  return KNOWLEDGE_ARTICLES.find((a) => a.slug === slug) ?? null;
}

// Homepage cards only — 3 featured slugs, in FEATURED_KNOWLEDGE_SLUGS order.
export function getFeaturedKnowledgeArticles(): KnowledgeMeta[] {
  return FEATURED_KNOWLEDGE_SLUGS.map((slug) => getKnowledgeMeta(slug)).filter(
    (a): a is KnowledgeMeta => a !== null
  );
}
