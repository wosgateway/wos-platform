// Ported from window.WOS_CATEGORIES in the old js/main.js.
// The `label` object is gone — that text now lives in src/messages/*.json
// under `categories.<slug>` so it's indexable per-locale instead of
// hidden/shown via .lang-content CSS classes.

export type CategorySlug =
  | 'hospital'
  | 'clinic'
  | 'dental'
  | 'wellness'
  | 'spa'
  | 'hotel_transport';

export interface Category {
  slug: CategorySlug;
  icon: string;
  image: string;
  dbCategories: string[];
}

export const CATEGORIES: Category[] = [
  { slug: 'hospital', icon: '🏥', image: '/images/hospital.webp', dbCategories: ['Hospital'] },
  { slug: 'clinic', icon: '🩺', image: '/images/clinic.webp', dbCategories: ['Clinic'] },
  { slug: 'dental', icon: '🦷', image: '/images/dental.webp', dbCategories: ['Dental'] },
  { slug: 'wellness', icon: '🌿', image: '/images/wellness.webp', dbCategories: ['Wellness'] },
  { slug: 'spa', icon: '💆', image: '/images/spa.webp', dbCategories: ['Spa'] },
  {
    slug: 'hotel_transport',
    icon: '🏨',
    image: '/images/hotel-transport.webp',
    dbCategories: ['Hotel', 'Transport'],
  },
];

export function getCategoryBySlug(slug: string): Category | null {
  return CATEGORIES.find((c) => c.slug === slug) ?? null;
}
