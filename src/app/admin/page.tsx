'use client';

// PHASE 5 — "ภาพรวม" (Overview) added as the default tab: a
// derived-from-status Task view (see OverviewManager.tsx /
// api/admin/overview) so staff land on "what needs attention" instead
// of the partners list when they open /admin.
//
// Tab state is driven by the `?tab=` query param (not just local
// useState) so other pages / the nav bar can link straight to a
// specific tab, e.g. /admin?tab=partners — see AdminGate.tsx's
// NAV_LINKS. Wrapped in <Suspense> per this repo's existing
// useSearchParams() convention (see src/app/login/page.tsx).
//
// 'commercial-terms' tab added for migration 098 (per-partner MOU
// commission rate) — deliberately NOT in AdminGate.tsx's top-level
// NAV_LINKS (unlike transport-pricing) since this data is confidential
// per MOU ข้อ 7 and doesn't need one-click nav-bar prominence; still
// reachable via /admin?tab=commercial-terms or this tab strip.

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OverviewManager } from '@/components/admin/OverviewManager';
import { PartnersManager } from '@/components/admin/PartnersManager';
import { PackagesManager } from '@/components/admin/PackagesManager';
import { BookingsManager } from '@/components/admin/BookingsManager';
import { PartnerLeadsHub } from '@/components/admin/PartnerLeadsHub';
import { ConsultationsManager } from '@/components/admin/ConsultationsManager';
import { TransportPricingManager } from '@/components/admin/TransportPricingManager';
import { PromoBannersManager } from '@/components/admin/PromoBannersManager';
import { PartnerCommercialTermsManager } from '@/components/admin/PartnerCommercialTermsManager';
import { SettlementsManager } from '@/components/admin/SettlementsManager';

type AdminTab =
  | 'overview'
  | 'partners'
  | 'packages'
  | 'bookings'
  | 'leads'
  | 'consultations'
  | 'transport-pricing'
  | 'commercial-terms'
  | 'settlements'
  | 'promo-banners';

const VALID_TABS: AdminTab[] = [
  'overview',
  'partners',
  'packages',
  'bookings',
  'leads',
  'consultations',
  'transport-pricing',
  'commercial-terms',
  'settlements',
  'promo-banners',
];

const TAB_LABELS: Record<AdminTab, string> = {
  overview: 'ภาพรวม',
  partners: 'พาร์ทเนอร์',
  packages: 'แพ็กเกจ',
  bookings: 'รายการจอง',
  leads: 'พันธมิตรสมัครใหม่',
  consultations: 'ปรึกษาฟรี',
  'transport-pricing': 'ราคารถ',
  'commercial-terms': 'ค่าคอมมิชชั่น',
  settlements: 'Settlement',
  'promo-banners': 'แบนเนอร์',
};

function AdminPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const requestedTab = searchParams.get('tab');
  const tab: AdminTab = VALID_TABS.includes(requestedTab as AdminTab)
    ? (requestedTab as AdminTab)
    : 'overview';

  function setTab(next: AdminTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    const query = params.toString();
    router.push(query ? `/admin?${query}` : '/admin');
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex gap-1 border-b border-slate-100 px-4 pt-2">
        {VALID_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === t ? 'border-b-2 border-primary text-primary-dark' : 'text-slate-400'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <OverviewManager />
      ) : tab === 'partners' ? (
        <PartnersManager />
      ) : tab === 'packages' ? (
        <PackagesManager />
      ) : tab === 'bookings' ? (
        <BookingsManager />
      ) : tab === 'leads' ? (
        <PartnerLeadsHub />
      ) : tab === 'consultations' ? (
        <ConsultationsManager />
      ) : tab === 'transport-pricing' ? (
        <TransportPricingManager />
      ) : tab === 'commercial-terms' ? (
        <PartnerCommercialTermsManager />
      ) : tab === 'settlements' ? (
        <SettlementsManager />
      ) : (
        <PromoBannersManager />
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-400">กำลังโหลด...</div>}>
      <AdminPageContent />
    </Suspense>
  );
}
