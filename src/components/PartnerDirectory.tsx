'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PartnerCard } from './PartnerCard';
import type { Partner } from '@/lib/data';
import { distinctProvinces, normalizeProvince } from '@/lib/province';

export function PartnerDirectory({ partners }: { partners: Partner[] }) {
  const t = useTranslations('partnerDirectory');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [province, setProvince] = useState<string>('all');

  // หมวดหมู่/จังหวัด สร้างจากข้อมูลจริงที่มี ไม่ hardcode ไว้ล่วงหน้า
  // (ถ้าอยากได้ label แปลตามภาษา ต้อง map ค่า category ของ DB เช่น "Hospital"
  // ให้ตรงกับ key ใน messages/*.json namespace "categories" เพิ่มเติมทีหลัง —
  // ตอนนี้แสดงค่าดิบจาก DB ไปก่อนเพื่อไม่ให้ scope บวมเกินไป)
  const categories = useMemo(() => {
    const set = new Set(partners.map((p) => p.category).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [partners]);

  // Normalized + deduped — without this, "กรุงเทพฯ" and "กรุงเทพ" show up
  // as two separate dropdown options for what's really one province.
  // See src/lib/province.ts for the alias list.
  const provinces = useMemo(() => distinctProvinces(partners), [partners]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners.filter((p) => {
      const name = (p.name ?? '').toLowerCase();
      const prov = ((p.province as string) ?? '').toLowerCase();
      const matchesQuery = !q || name.includes(q) || prov.includes(q);
      const matchesCategory = category === 'all' || p.category === category;
      // Compare normalized forms so a partner stored as "กรุงเทพ" still
      // matches when the user picks the canonical "กรุงเทพฯ" option.
      const matchesProvince = province === 'all' || normalizeProvince(p.province) === province;
      return matchesQuery && matchesCategory && matchesProvince;
    });
  }, [partners, search, category, province]);

  return (
    <div>
      {/* ===== Sticky filter bar ===== */}
      <div className="sticky top-0 z-10 -mx-4 mb-8 border-b border-slate-100 bg-white/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-5 sm:shadow-sm">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="form-input mb-3"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              category === 'all' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t('allCategories')} ({partners.length})
          </button>
          {categories.map((cat) => {
            const count = partners.filter((p) => p.category === cat).length;
            return (
              <button
                type="button"
                key={cat}
                onClick={() => setCategory(cat)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  category === cat ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        {provinces.length > 1 ? (
          <select
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            className="form-input mt-3 bg-white sm:max-w-xs"
          >
            <option value="all">{t('allProvinces')}</option>
            {provinces.map((prov) => (
              <option key={prov} value={prov}>
                {prov}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {/* ===== Results ===== */}
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-slate-400">{t('noResults')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((partner) => (
            <PartnerCard key={partner.id} partner={partner} />
          ))}
        </div>
      )}
    </div>
  );
}
