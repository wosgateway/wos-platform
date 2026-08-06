import type { ReactNode } from 'react';
import { Geist } from "next/font/google";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


// This root layout only exists because Next.js requires one at src/app.
// All real markup (html/body/fonts/providers) lives further down:
// src/app/[locale]/layout.tsx for public, locale-prefixed pages, and
// src/app/admin/layout.tsx for the internal Thai-only admin panel.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
