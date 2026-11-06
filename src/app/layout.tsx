import React, { type ReactNode } from 'react';
import { headers } from 'next/headers';
import './globals.css';

const SUPPORTED_LOCALES = new Set(['th', 'lo', 'en']);

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The root layout sits above [locale], so read the validated locale that
  // middleware forwards on the request instead of relying on route params.
  const requestedLocale = headers().get('x-wos-locale');
  const locale = requestedLocale && SUPPORTED_LOCALES.has(requestedLocale)
    ? requestedLocale
    : 'th';

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans bg-white text-slate-900">{children}</body>
    </html>
  );
}
