// src/lib/knowledge.ts
// Metadata for the "Knowledge Center" articles shown on the homepage
// (replacing the old HowItWorks 3-step block, which duplicated JourneyTimeline)
// and on /knowledge, /knowledge/[slug]. Icons live here (not translatable);
// all text content lives in messages/*.json under `home.knowledge` (homepage
// cards) and `knowledge.articles.<slug>` (full article body).

export type KnowledgeSlug =
  | 'lao-cross-border-treatment'
  | 'insurance-coverage'
  | 'clinic-vs-hospital';

export interface KnowledgeMeta {
  slug: KnowledgeSlug;
  icon: string;
  image: string;
}

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
];

export function getKnowledgeMeta(slug: string): KnowledgeMeta | null {
  return KNOWLEDGE_ARTICLES.find((a) => a.slug === slug) ?? null;
}
