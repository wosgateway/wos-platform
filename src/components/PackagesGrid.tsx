'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PackageCard } from '@/components/PackageCard';
import type { Package } from '@/lib/data';

export function PackagesGrid({ packages }: { packages: Package[] }) {
  const [filter, setFilter] = useState<'all' | 'promo'>('all');
  const t = useTranslations('common');

  const filtered = filter === 'promo' ? packages.filter((p) => p.is_promotion) : packages;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
          {t('programsAndServices')}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              filter === 'all' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {t('allPackages')}
          </button>
          <button
            onClick={() => setFilter('promo')}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              filter === 'promo' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {t('promoOnly')}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400">
          <span className="text-3xl">📋</span>
          <p className="mt-2">{t('noPrograms')}</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} />
          ))}
        </div>
      )}
    </>
  );
}
