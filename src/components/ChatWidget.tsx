'use client';

// src/components/ChatWidget.tsx
//
// Floating live-chat bubble, using Crisp (https://crisp.chat) as the
// hosted widget provider — same "ready-made widget" tradeoff as
// WhatsAppButton.tsx already makes, just for visitors without WhatsApp
// and for a real agent inbox (assign/route/reply from crisp.chat, no
// custom real-time backend to build or maintain).
//
// Quietly renders nothing if NEXT_PUBLIC_CRISP_WEBSITE_ID isn't
// configured, mirroring the guard PartnerLocationMap.tsx uses for
// NEXT_PUBLIC_MAPBOX_TOKEN — safe to mount everywhere even before a
// Crisp workspace exists.
//
// Setup:
//   1. npm install crisp-sdk-web
//   2. Create a workspace at https://app.crisp.chat, then copy the
//      Website ID from Settings -> Website Settings -> Setup instructions.
//   3. Add NEXT_PUBLIC_CRISP_WEBSITE_ID=<that id> to .env.local (and to
//      the host's env for prod/staging).
//
// Positioning: WhatsAppButton already occupies bottom-right (bottom-5/6
// right-5/6 — see that file). Crisp defaults to the same corner, so
// this flips Crisp to bottom-LEFT (position:reverse) to stop the two
// floating buttons stacking on mobile. If WhatsAppButton is ever
// removed, drop the position:reverse call to get the bottom-right
// placement from the reference screenshot instead.

import { useEffect, useRef } from 'react';
import { useLocale } from 'next-intl';
import { Crisp } from 'crisp-sdk-web';

declare global {
  interface Window {
    CRISP_RUNTIME_CONFIG?: { locale?: string };
  }
}

// Crisp's chatbox UI ships th/en translations; there's no Lao option,
// so Lao visitors fall back to English rather than a Thai UI they may
// not read.
const CRISP_LOCALE_MAP: Record<string, string> = {
  th: 'th',
  en: 'en',
  lo: 'en',
};

export function ChatWidget() {
  const locale = useLocale();
  const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;
  const configured = useRef(false);

  useEffect(() => {
    if (!websiteId || configured.current) return;
    configured.current = true;

    // CRISP_RUNTIME_CONFIG must be set before Crisp.configure() runs —
    // see Crisp's "Language Customization" guide. Locale switches in
    // this app go through next-intl's routing (a real navigation to a
    // different URL prefix), so re-reading `locale` on first mount of
    // each page load is enough; Crisp doesn't support changing an
    // already-configured chatbox's locale in place.
    window.CRISP_RUNTIME_CONFIG = { locale: CRISP_LOCALE_MAP[locale] ?? 'en' };

    Crisp.configure(websiteId);
    window.$crisp?.push(['config', 'position:reverse', [true]]);
  }, [websiteId, locale]);

  return null;
}
