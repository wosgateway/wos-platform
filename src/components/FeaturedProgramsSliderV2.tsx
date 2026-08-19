'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { ProgramCardV2 } from '@/components/ProgramCardV2';
import type { Package } from '@/lib/data';

/**
 * STEP 8 preview — identical slider mechanics to FeaturedProgramsSlider.tsx,
 * swapped to render ProgramCardV2 instead of PackageCard so the new card
 * design can be compared side by side on the homepage before it replaces
 * the original everywhere (FeaturedProgramsSlider.tsx + PackagesGrid.tsx).
 */
export function FeaturedProgramsSliderV2({ packages }: { packages: Package[] }) {
  const t = useTranslations('home');
  const trackRef = useRef<HTMLDivElement>(null);

  if (packages.length === 0) return null;

  const scrollByCard = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('[data-slide]');
    const step = (card?.offsetWidth ?? 280) + 20; // การ์ด + gap
    track.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  return (
    <section className="section-padding bg-white">
      <div className="mx-auto max-w-5xl px-4">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
              {t('featured.title')}
            </h2>
            <p className="mt-2 text-slate-500">{t('featured.subtitle')}</p>
          </div>
          <div className="hidden shrink-0 gap-2 sm:flex">
            <button
              onClick={() => scrollByCard(-1)}
              aria-label={t('featured.prev')}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
            >
              ‹
            </button>
            <button
              onClick={() => scrollByCard(1)}
              aria-label={t('featured.next')}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
            >
              ›
            </button>
          </div>
        </div>

        <div
          ref={trackRef}
          className="flex snap-x snap-mandatory gap-5 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              data-slide
              className="w-[75%] shrink-0 snap-start sm:w-[45%] lg:w-[31%]"
            >
              <ProgramCardV2 pkg={pkg} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
