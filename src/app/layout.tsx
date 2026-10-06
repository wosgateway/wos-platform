import type { ReactNode } from 'react';
import './globals.css';

export default function RootLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  return (
    <html
      lang={locale ?? 'th'}
      suppressHydrationWarning
    >
      <body className="font-sans bg-white text-slate-900">{children}</body>
    </html>
  );
}