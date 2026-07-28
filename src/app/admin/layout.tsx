import type { ReactNode } from 'react';
import { Prompt } from 'next/font/google';
import '../globals.css';

// /admin sits outside the [locale] segment (it's an internal Thai-only
// tool, not a public multi-language page), so unlike every other route
// it doesn't inherit html/body from [locale]/layout.tsx — it needs its
// own, or Next.js has no <html>/<body> to render at all.
const prompt = Prompt({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-prompt',
});

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={prompt.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900">{children}</body>
    </html>
  );
}
