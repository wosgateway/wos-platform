'use client';

// src/components/LocaleSwitcher.tsx
//
// Was a 3-way segmented toggle (all locales always visible as buttons).
// Switched to a dropdown per feedback — click a single "current language"
// trigger to reveal the other options, same pattern as Amazon's language
// picker. Built on radix-ui's DropdownMenu (same 'radix-ui' unified
// package MobileNavDrawer.tsx already uses for Dialog) instead of a raw
// useState + outside-click handler, so focus trapping, Escape-to-close,
// and outside-click are handled for free.

import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

// Full language names in their own script — an Amazon-style picker shows
// what each option looks like natively (English / ไทย / ລາວ), not the
// current locale's translation of "Thai"/"Lao"/"English".
const LOCALE_NAMES: Record<string, string> = {
  th: 'ไทย',
  lo: 'ລາວ',
  en: 'English',
};

const LOCALE_SHORT: Record<string, string> = { th: 'TH', lo: 'ລາວ', en: 'EN' };

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t('selectLanguage')}
        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 data-[state=open]:bg-slate-200"
      >
        <Globe className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {LOCALE_SHORT[locale]}
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[9rem] overflow-hidden rounded-xl border border-slate-100 bg-white p-1 shadow-lg duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          {routing.locales.map((l) => (
            <DropdownMenu.Item
              key={l}
              onSelect={() => router.replace(pathname, { locale: l })}
              className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm outline-none transition-colors ${
                l === locale
                  ? 'font-semibold text-primary-dark'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-primary-dark'
              }`}
            >
              {LOCALE_NAMES[l]}
              {l === locale && <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
