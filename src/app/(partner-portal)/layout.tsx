import type { ReactNode } from 'react';
import { Prompt } from 'next/font/google';
import '../globals.css';
import { requirePartnerAuth } from '@/lib/partner/auth';
import { PartnerSidebar } from '@/components/partner/PartnerSidebar';
import { PartnerHeader } from '@/components/partner/PartnerHeader';
import { NotificationBell } from '@/components/partner/NotificationBell';

const prompt = Prompt({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-prompt',
});

export default async function PartnerPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await requirePartnerAuth();

  return (
    <html lang="th" className={prompt.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900">
        <div className="flex min-h-screen bg-slate-50">
          <PartnerSidebar user={user} />
          <div className="flex-1 flex flex-col min-w-0">
            <PartnerHeader user={user}>
              <NotificationBell organizationId={user.organization_id} />
            </PartnerHeader>
            <main className="flex-1 p-4 md:p-6 overflow-y-auto">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}