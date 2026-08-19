import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { JourneyProvider } from '@/lib/journey/context';
import { JourneyCartBar } from '@/components/journey/JourneyCartBar';
import { LangSetter } from '@/components/LangSetter';

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

  return (
    <NextIntlClientProvider messages={messages}>
      <LangSetter locale={locale} />
      <JourneyProvider>
        <Header />
        {children}
        <Footer />
        <WhatsAppButton />
        <JourneyCartBar />
      </JourneyProvider>
    </NextIntlClientProvider>
  );
}