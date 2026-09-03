'use client';

import { useTranslations } from 'next-intl';
import { MessageCircle, Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';

// Mobile-only bottom bar shown to visitors who haven't added anything to
// their journey yet (see MobileJourneyBar, which swaps this out for
// <JourneyCartBar /> the moment items.length > 0). Fills the gap called
// out in the mobile bottom-CTA brief: previously a first-time mobile
// visitor — the primary target audience, Lao customers on phones — saw
// no persistent CTA at all until they'd already added a program.
//
// Reuses the site's existing entry points rather than inventing new
// ones: "Find a Program" scrolls to the same #categories section every
// other nav link on the site points to (Header, Footer, HeroV2,
// MobileNavDrawer), and "Talk to WOS" opens the same WhatsApp number/
// message used by <WhatsAppButton /> — kept in sync with that file and
// Footer.tsx if the number ever changes.
// TEMPORARY: pointed at the Thai number (+66 86 452 2644) because the
// Laos number (+856 20 9872 4718) currently has no WhatsApp account.
// Switch back once WhatsApp is reactivated on the Laos number.
const WHATSAPP_NUMBER = '66864522644';

export function MobileStickyCta() {
  const t = useTranslations('journey.mobileCta');
  const tWhatsapp = useTranslations('whatsapp');

  const whatsappHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(tWhatsapp('message'))}`;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex gap-2 border-t border-slate-100 bg-white px-4 py-3 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] md:hidden">
      <Link
        href="/#categories"
        className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
      >
        <Search className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
        {t('findProgram')}
      </Link>
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-1 items-center justify-center gap-2 rounded-full border-2 border-primary px-4 py-3 text-sm font-semibold text-primary-dark transition-colors hover:bg-primary/5"
      >
        <MessageCircle className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
        {t('talkToWos')}
      </a>
    </div>
  );
}
