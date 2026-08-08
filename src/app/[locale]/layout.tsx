import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Prompt } from 'next/font/google';
import { routing } from '@/i18n/routing';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { JourneyProvider } from '@/lib/journey/context';
import { JourneyCartBar } from '@/components/journey/JourneyCartBar';
import '@/app/globals.css';

const prompt = Prompt({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-prompt',
});

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
    <html lang={locale} className={prompt.variable}>
      <body className="font-sans bg-white text-slate-900">
        <NextIntlClientProvider messages={messages}>
          <JourneyProvider>
            <Header />
            {children}
            <Footer />
            <WhatsAppButton />
            <JourneyCartBar />
          </JourneyProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
