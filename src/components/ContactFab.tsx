'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageCircle, X } from 'lucide-react';
import { getContactChannels } from '@/components/contact-channels';

// Multi-channel floating contact button (speed-dial FAB) — replaces the
// single-channel <WhatsAppButton />. Tap the main circle to expand a
// stack of round icon buttons (Messenger, WhatsApp, LINE, Phone), each
// in its own brand color; each reveals its plain-text label on
// hover/focus. Tap again (or the X, shown while open) to collapse.
//
// Desktop (md+) only. Below md, [locale]/layout.tsx also mounts
// <MobileStickyCta />, whose "คุยกับ WOS" button now opens this exact
// same 4-channel list (see MobileStickyCta.tsx) — so on mobile this
// floating circle would just be a second, unlabeled entry point doing
// the same job as a button that's already in the bottom bar. Hiding it
// below md removes that duplicate/confusing element; hover (which this
// component relies on for labels) works fine on md+ anyway.
//
// Position/offset logic simplified from the original WhatsAppButton.tsx
// footprint: since this component is md+ only now, the mobile
// MobileJourneyBar-clearance offset that footprint needed no longer
// applies here — bottom-6 is the original desktop resting position.
export function ContactFab() {
  const [open, setOpen] = useState(false);
  const tWhatsapp = useTranslations('whatsapp');
  const channels = getContactChannels(tWhatsapp('message'));

  return (
    <div className="fixed bottom-6 right-6 z-40 hidden flex-col items-end gap-3 md:flex">
      {channels.map((c, i) => (
        <a
          key={c.key}
          href={c.href}
          {...(c.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          aria-label={c.label}
          title={c.label}
          className={`group flex items-center gap-0 overflow-hidden rounded-full ${c.bg} shadow-lg shadow-black/20 transition-all duration-300 hover:gap-2 hover:pr-4 active:scale-95 ${
            open
              ? 'pointer-events-auto translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-4 opacity-0'
          }`}
          style={{ transitionDelay: open ? `${(channels.length - i) * 40}ms` : '0ms' }}
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center">{c.icon}</span>
          <span className="hidden max-w-0 whitespace-nowrap text-sm font-semibold text-white opacity-0 transition-all duration-300 group-hover:max-w-xs group-hover:opacity-100 sm:inline-block">
            {c.label}
          </span>
        </a>
      ))}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close contact menu' : 'Contact us'}
        aria-expanded={open}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 transition-transform duration-300 active:scale-95"
      >
        {open ? (
          <X className="h-6 w-6" strokeWidth={2.25} aria-hidden="true" />
        ) : (
          <MessageCircle className="h-6 w-6" strokeWidth={2.25} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
