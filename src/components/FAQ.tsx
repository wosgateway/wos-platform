'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export function FAQ() {
  const t = useTranslations('home.faq');
  const items = t.raw('items') as { q: string; a: string }[];
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="section-padding bg-primary-light/40">
      <div className="mx-auto max-w-3xl px-4">
        <h2 className="text-center text-2xl font-bold text-slate-900 md:text-3xl">
          {t('title')}
        </h2>
        <div className="mt-10 space-y-3">
          {items.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div
                key={item.q}
                className="overflow-hidden rounded-2xl border border-slate-100 bg-white"
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <span className="font-semibold text-slate-900">{item.q}</span>
                  <span
                    className={`shrink-0 text-xl leading-none text-primary transition-transform duration-200 ${
                      isOpen ? 'rotate-45' : ''
                    }`}
                    aria-hidden
                  >
                    +
                  </span>
                </button>
                {isOpen && (
                  <p className="px-5 pb-4 text-sm leading-relaxed text-slate-500">{item.a}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
