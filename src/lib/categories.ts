// Ported from window.WOS_CATEGORIES in the old js/main.js.
// The `label` object is gone — that text now lives in src/messages/*.json
// under `categories.<slug>` so it's indexable per-locale instead of
// hidden/shown via .lang-content CSS classes.
//
// Icon: switched from emoji strings to lucide-react components so the
// category tiles match the line-icon system already used in WhyWosV2.tsx
// and WOSNetworkDiagram.tsx, instead of rendering the OS's default emoji
// glyph set (which looks inconsistent/low-end across devices).

import { Hospital, Stethoscope, Smile, Leaf, Sparkles, BedDouble, type LucideIcon } from 'lucide-react';

export type CategorySlug =
  | 'hospital'
  | 'clinic'
  | 'dental'
  | 'wellness'
  | 'spa'
  | 'hotel_transport';

export interface Category {
  slug: CategorySlug;
  icon: LucideIcon;
  image: string;
  dbCategories: string[];
}

export const CATEGORIES: Category[] = [
  { slug: 'hospital', icon: Hospital, image: '/images/hospital.webp', dbCategories: ['Hospital'] },
  { slug: 'clinic', icon: Stethoscope, image: '/images/clinic.webp', dbCategories: ['Clinic'] },
  { slug: 'dental', icon: Smile, image: '/images/dental.webp', dbCategories: ['Dental'] },
  { slug: 'wellness', icon: Leaf, image: '/images/wellness.webp', dbCategories: ['Wellness'] },
  { slug: 'spa', icon: Sparkles, image: '/images/spa.webp', dbCategories: ['Spa'] },
  {
    slug: 'hotel_transport',
    icon: BedDouble,
    image: '/images/hotel-transport.webp',
    dbCategories: ['Hotel', 'Transport'],
  },
];

export function getCategoryBySlug(slug: string): Category | null {
  return CATEGORIES.find((c) => c.slug === slug) ?? null;
}
