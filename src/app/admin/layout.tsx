import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { AdminGate } from '@/components/admin/AdminGate';

export default function AdminLayout({ children }: { children: ReactNode }) {
  // AdminGate uses useSearchParams() (to highlight the active tab link,
  // e.g. /admin?tab=partners) which requires a <Suspense> boundary above
  // it — same convention as src/app/login/page.tsx.
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-400">กำลังตรวจสอบสิทธิ์...</div>}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
