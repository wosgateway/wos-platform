'use client';

import { useTranslations } from 'next-intl';
import { useJourney } from '@/lib/journey/context';
import type { Package } from '@/lib/data';
import type { MouseEvent } from 'react';

function packagePrice(pkg: Package): number {
  return Number((pkg.special_price as number) ?? (pkg.original_price as number) ?? 0);
}

export function AddToJourneyButton({
  pkg,
  variant = 'default',
}: {
  pkg: Package;
  // 'compact' is for use inside PackageCard, which is itself a <Link> —
  // keep it small and stop the click from also triggering navigation.
  variant?: 'default' | 'compact';
}) {
  const t = useTranslations('journey');
  const { addItem, removeItem, isInJourney } = useJourney();
  const inJourney = isInJourney(pkg.id);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (inJourney) {
      removeItem(pkg.id);
      return;
    }
    addItem({
      id: pkg.id,
      title: pkg.title as string,
      price: packagePrice(pkg),
      image_url: (pkg.image_url as string | null) ?? null,
      category: pkg.partners?.category ?? null,
      partnerName: pkg.partners?.name ?? null,
    });
  }

  const base =
    variant === 'compact'
      ? 'w-full rounded-full px-3 py-1.5 text-xs font-semibold transition'
      : 'w-full rounded-full px-5 py-2.5 text-sm font-semibold transition sm:w-auto';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`${base} ${
        inJourney
          ? 'bg-primary text-white'
          : 'border border-primary text-primary-dark hover:bg-primary-light/40'
      }`}
    >
      {inJourney ? `✓ ${t('added')}` : `+ ${t('addToJourney')}`}
    </button>
  );
}
