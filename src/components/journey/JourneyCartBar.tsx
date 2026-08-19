'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { formatTHB } from '@/lib/format';
import { normalizeImageSrc } from '@/lib/image';
import { useJourney } from '@/lib/journey/context';

// Mounted once in [locale]/layout.tsx (same pattern as WhatsAppButton).
// Renders nothing while the cart is empty, so it never gets in the way
// on pages the customer hasn't started building a journey on yet.
export function JourneyCartBar() {
  const t = useTranslations('journey');
  const { items, removeItem, total } = useJourney();
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      <div
        className={`fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-slate-100 bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.12)] transition-transform duration-300 ${
          open ? 'translate-y-0' : 'translate-y-[calc(100%-4.5rem)]'
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-5 py-4"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {items.length}
            </span>
            {t('cartBarLabel')}
          </span>
          <span className="flex items-center gap-2 text-sm font-bold text-primary-dark">
            {formatTHB(total)}
            <span className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
              –²
            </span>
          </span>
        </button>

        <div className="max-h-[55vh] overflow-y-auto px-5 pb-5">
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-slate-100 p-2"
              >
                {item.image_url ? (
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                    <Image
                      src={normalizeImageSrc(item.image_url)}
                      alt={item.title}
                      fill
                      className="object-cover"
                      sizes="48px"
                    />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                  {item.partnerName ? (
                    <p className="truncate text-xs text-slate-400">{item.partnerName}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-semibold text-slate-700">
                  {formatTHB(item.price)}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label={t('remove')}
                  className="shrink-0 rounded-full p-1 text-slate-300 hover:text-red-500"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <Link
            href="/booking/journey"
            onClick={() => setOpen(false)}
            className="btn-primary mt-4 w-full justify-center text-base"
          >
            {t('goToBooking')}
          </Link>
        </div>
      </div>
    </>
  );
}
