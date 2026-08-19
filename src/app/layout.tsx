import type { ReactNode } from 'react';
import { Prompt, Noto_Sans_Lao } from 'next/font/google';
import './globals.css';

const prompt = Prompt({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-prompt',
});

// Prompt has no Lao glyphs at all (Cadson Demak only ships thai/latin/vietnamese),
// so the /lo pages were silently falling back to the OS default font. Noto Sans Lao
// is the closest-weight match available on Google Fonts for pairing with Prompt.
const notoSansLao = Noto_Sans_Lao({
  subsets: ['lao'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-lao',
});

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
      className={`${prompt.variable} ${notoSansLao.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans bg-white text-slate-900">{children}</body>
    </html>
  );
}