'use client';

import { useJourney } from '@/lib/journey/context';
import { JourneyCartBar } from '@/components/journey/JourneyCartBar';
import { MobileStickyCta } from '@/components/journey/MobileStickyCta';

// Single mount point for the bottom-of-screen journey bar (see
// [locale]/layout.tsx). Reads cart state once here so JourneyCartBar
// itself doesn't need to know about the empty-state CTA, and the empty
// CTA doesn't need to know about cart items — each component still
// only does one job.
export function MobileJourneyBar() {
  const { items } = useJourney();

  return items.length > 0 ? <JourneyCartBar /> : <MobileStickyCta />;
}
