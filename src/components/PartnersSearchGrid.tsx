'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PartnerCard } from '@/components/PartnerCard';
import type { Partner } from '@/lib/data';

// Consumer-facing search: filters the partner list already fetched
// server-side for this category (SSR in category/page.tsx). No extra
// Supabase round-trip on keystroke — the list per category is small
// enough to filter client-side, same tradeoff PackagesGrid.tsx already
// makes for the promo/all toggle on /partner/[id].
export function PartnersSearchGrid({ partners }: { partners: Partner[] }) {
  const t = useTranslations('common');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) => {
      const name = p.name?.toLowerCase() ?? '';
      const province = (p.province as string | undefined)?.toLowerCase() ?? '';
      return name.includes(q) || province.includes(q);
    });
  }, [partners, query]);

  return (
    <>
      <div className="relative mb-6">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
          🔍
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="form-input pl-11"
          aria-label={t('searchPlaceholder')}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400">
          <span className="text-3xl">🔍</span>
          <p className="mt-2">{query ? t('noSearchResults') : t('noPartners')}</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((partner) => (
            <PartnerCard key={partner.id} partner={partner} />
          ))}
        </div>
      )}
    </>
  );
}
