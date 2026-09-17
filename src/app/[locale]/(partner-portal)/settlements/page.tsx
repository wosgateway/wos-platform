// src/app/(partner-portal)/settlements/page.tsx
//
// Phase 6 (Partner Portal) — read-only settlement visibility. Same
// shape as billing/page.tsx: requirePartnerAuth() for the page shell,
// the actual data fetch happens client-side in SettlementsSection
// (see that file for why — settlements/settlement_items have no RLS
// client policies, so this has to go through /api/partner/settlements
// rather than a server-side supabase query here).

import { requirePartnerAuth } from '@/lib/partner/auth';
import { SettlementsSection } from '@/components/partner/SettlementsSection';

export default async function SettlementsPage() {
  await requirePartnerAuth();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Settlement</h1>
        <p className="text-sm text-slate-500">ยอดคอมมิชชั่นที่ต้องชำระให้ WOS แต่ละงวด</p>
      </div>
      <SettlementsSection />
    </div>
  );
}
