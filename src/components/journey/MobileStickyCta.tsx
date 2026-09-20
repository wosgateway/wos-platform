'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageCircle, Search, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getContactChannels } from '@/components/contact-channels';

// Mobile-only bottom bar shown to visitors who haven't added anything to
// their journey yet (see MobileJourneyBar, which swaps this out for
// <JourneyCartBar /> the moment items.length > 0).
//
// 2026-09: "คุยกับ WOS" used to link straight to WhatsApp. It now opens
// the same 4-channel picker (Messenger/WhatsApp/LINE/Phone) as the
// desktop-only <ContactFab />, via getContactChannels() — same data, so
// numbers/IDs can't drift between the two entry points. <ContactFab />
// itself is hidden below md (see that file), specifically so this bar
// is the single mobile contact entry point instead of a second, floating,
// unlabeled circle stacked on top of it doing the same job.
//
// Unlike ContactFab's hover-reveal channel labels (fine on desktop
// mouse), the picker below shows labels inline, always — hover never
// fires on a touch device, so an icon-only channel button here would be
// unreadable until tapped.
export function MobileStickyCta() {
  const [open, setOpen] = useState(false);
  const t = useTranslations('journey.mobileCta');
  const tWhatsapp = useTranslations('whatsapp');
  const channels = getContactChannels(tWhatsapp('message'));

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 md:hidden">
      {open && (
        <div className="flex flex-col items-end gap-2 px-4 pb-3">
          {channels.map((c) => (
            <a
              key={c.key}
              href={c.href}
              {...(c.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className={`flex items-center gap-2 rounded-full ${c.bg} py-2.5 pl-4 pr-5 shadow-lg shadow-black/20 active:scale-95`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">{c.icon}</span>
              <span className="whitespace-nowrap text-sm font-semibold text-white">
                {c.label}
              </span>
            </a>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-t border-slate-100 bg-white px-4 py-3 shadow-[0_-8px_30px_rgba(0,0,0,0.12)]">
        <Link
          href="/#categories"
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          <Search className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          {t('findProgram')}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 items-center justify-center gap-2 rounded-full border-2 border-primary px-4 py-3 text-sm font-semibold text-primary-dark transition-colors hover:bg-primary/5"
        >
          {open ? (
            <X className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <MessageCircle className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          )}
          {t('talkToWos')}
        </button>
      </div>
    </div>
  );
}
