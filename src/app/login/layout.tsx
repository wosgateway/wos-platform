import type { ReactNode } from 'react';
import { Prompt } from 'next/font/google';
import '../globals.css';

const prompt = Prompt({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-prompt',
});

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={prompt.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900">
        {children}
      </body>
    </html>
  );
}