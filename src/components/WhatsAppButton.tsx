'use client';

import { useTranslations } from 'next-intl';

// Lao customers primarily reach out via WhatsApp, so this floating button
// stays visible on every public page (mounted once in [locale]/layout.tsx,
// next to Header/Footer). TEMPORARY: pointed at the Thai number
// (+66 86 452 2644) because the Laos number (+856 20 9872 4718) currently
// has no WhatsApp account. Switch back to the Laos number once WhatsApp is
// reactivated on it — kept in sync with MobileStickyCta.tsx and Footer.tsx.
//
// Bottom offset (2026-09 fix): on mobile (< md), [locale]/layout.tsx also
// mounts MobileJourneyBar, which always renders either <JourneyCartBar />
// or <MobileStickyCta /> — never neither — as a full-width `fixed
// inset-x-0 bottom-0 z-50` bar roughly 4.5rem tall. This button used to
// sit at `bottom-5` (20px), which is well inside that bar's 0–72px
// footprint, so the higher-z-index bar rendered on top and covered most
// of the button — the opposite of "stays visible on every page" above.
// `bottom-[calc(4.5rem+1.25rem+env(safe-area-inset-bottom))]` clears the
// bar (4.5rem) plus a 1.25rem gap plus the iOS home-indicator safe area,
// only below `md`, where that bar exists; `md:bottom-6` restores the
// original close-to-corner position once the bar is `md:hidden`.
const WHATSAPP_NUMBER = '66864522644';

export function WhatsAppButton() {
  const t = useTranslations('whatsapp');

  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(t('message'))}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('ariaLabel')}
      title={t('tooltip')}
      className="group fixed right-5 z-40 flex items-center gap-0 overflow-hidden rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 transition-all duration-300 hover:gap-2 hover:pr-4 hover:shadow-xl active:scale-95 bottom-[calc(4.5rem+1.25rem+env(safe-area-inset-bottom))] sm:right-6 md:bottom-6"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center">
        <svg viewBox="0 0 32 32" className="h-7 w-7 fill-white" aria-hidden="true">
          <path d="M16.004 3C9.377 3 4 8.373 4 15c0 2.386.696 4.61 1.897 6.478L4 29l7.72-1.86A11.94 11.94 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3Zm7.02 16.98c-.293.824-1.462 1.53-2.397 1.727-.638.135-1.47.243-4.27-.917-3.582-1.483-5.89-5.1-6.07-5.34-.176-.24-1.45-1.93-1.45-3.68s.912-2.61 1.235-2.967c.324-.357.706-.446.94-.446.235 0 .47.002.674.012.216.01.507-.082.793.605.293.7.994 2.42 1.08 2.596.088.176.147.383.03.62-.117.238-.176.383-.352.588-.176.206-.37.46-.53.618-.176.176-.36.367-.155.72.206.352.916 1.51 1.966 2.446 1.35 1.205 2.49 1.578 2.842 1.755.352.176.558.147.764-.088.206-.235.882-1.028 1.117-1.38.235-.353.47-.294.793-.176.323.117 2.048.966 2.4 1.142.352.176.587.264.674.412.088.147.088.85-.205 1.674Z" />
        </svg>
      </span>
      <span className="hidden max-w-0 whitespace-nowrap text-sm font-semibold opacity-0 transition-all duration-300 group-hover:max-w-xs group-hover:opacity-100 sm:inline-block">
        {t('tooltip')}
      </span>
    </a>
  );
}
