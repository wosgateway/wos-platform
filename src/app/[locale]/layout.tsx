import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ContactFab } from '@/components/ContactFab';
import { JourneyProvider } from '@/lib/journey/context';
import { MobileJourneyBar } from '@/components/journey/MobileJourneyBar';
import { LangSetter } from '@/components/LangSetter';
import { WosStructuredData } from '@/components/seo/WosStructuredData';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  const messages = await getMessages();

  // 2026-08: (partner-portal) sits under this SAME [locale] segment
  // (see middleware.ts's isPartnerPortalRest comment for why it
  // can't be told apart from public routes by locale-prefix alone).
  // That means partner-portal pages were rendering inside BOTH this
  // layout's public Header/Footer AND their own
  // PartnerHeader/PartnerSidebar — two navigation chromes stacked on
  // one screen. middleware.ts sets x-partner-portal on every request
  // using the exact same isPartnerPortalRest() check the auth guard
  // already relies on, so this stays in sync with that logic by
  // construction instead of re-deriving it here from the pathname.
  const isPartnerPortal = headers().get('x-partner-portal') === '1';

  return (
    <NextIntlClientProvider messages={messages}>
      <WosStructuredData />
      <LangSetter locale={locale} />
      <JourneyProvider>
        {!isPartnerPortal && <Header />}
        {children}
        {!isPartnerPortal && (
          <>
            <Footer />
            {/* MobileJourneyBar is position:fixed at the bottom of the
                viewport on mobile (see MobileStickyCta / JourneyCartBar),
                so it sits on top of whatever content is last on the page
                instead of pushing it up. This spacer reserves that space
                in normal flow so the bar never covers real content. */}
            <div
              className="h-[calc(4.5rem+env(safe-area-inset-bottom))] md:hidden"
              aria-hidden="true"
            />
            <ContactFab />
            {/* ChatWidget (Crisp) removed 2026-09, and WhatsAppButton
                replaced by ContactFab 2026-09 (see ContactFab.tsx):
                Messenger, WhatsApp, LINE and Phone are now all reachable
                from this one speed-dial FAB instead of a single-channel
                button, so a separate live-chat widget stays unneeded.
                Kept ChatWidget.tsx and its Crisp setup instructions in
                the repo, unused, in case a chat widget is wanted again
                later; re-add by importing it and dropping <ChatWidget />
                back in here. */}
            <MobileJourneyBar />
          </>
        )}
      </JourneyProvider>
    </NextIntlClientProvider>
  );
}
