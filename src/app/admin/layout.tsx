import type { ReactNode } from 'react';
import { Prompt } from 'next/font/google';
import { AdminGate } from '@/components/admin/AdminGate';
import '../globals.css';

const prompt = Prompt({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-prompt',
});

// Root layout (src/app/layout.tsx) intentionally has no <html>/<body> —
// it delegates real markup to this file for everything under /admin,
// the same way src/app/[locale]/layout.tsx does for public pages.
// globals.css + the Prompt font are duplicated here (not shared via a
// common parent) because admin sits outside [locale] on purpose —
// internal Thai-only tool, no i18n routing needed.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={prompt.variable}>
      <body className="font-sans bg-white text-slate-900">
        <AdminGate>{children}</AdminGate>
      </body>
    </html>
  );
}
