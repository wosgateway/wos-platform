'use client';

// PHASE 5 — "ภาพรวม" (Overview) added as the default tab: a
// derived-from-status Task view (see OverviewManager.tsx /
// api/admin/overview) so staff land on "what needs attention" instead
// of the partners list when they open /admin.

import { useState } from 'react';
import { OverviewManager } from '@/components/admin/OverviewManager';
import { PartnersManager } from '@/components/admin/PartnersManager';
import { PackagesManager } from '@/components/admin/PackagesManager';
import { BookingsManager } from '@/components/admin/BookingsManager';
import { PartnerLeadsManager } from '@/components/admin/PartnerLeadsManager';

export default function AdminPage() {
  const [tab, setTab] = useState<'overview' | 'partners' | 'packages' | 'bookings' | 'leads'>(
    'overview'
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex gap-1 border-b border-slate-100 px-4 pt-2">
        <button
          onClick={() => setTab('overview')}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
            tab === 'overview' ? 'border-b-2 border-primary text-primary-dark' : 'text-slate-400'
          }`}
        >
          ภาพรวม
        </button>
        <button
          onClick={() => setTab('partners')}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
            tab === 'partners' ? 'border-b-2 border-primary text-primary-dark' : 'text-slate-400'
          }`}
        >
          พาร์ทเนอร์
        </button>
        <button
          onClick={() => setTab('packages')}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
            tab === 'packages' ? 'border-b-2 border-primary text-primary-dark' : 'text-slate-400'
          }`}
        >
          แพ็กเกจ
        </button>
        <button
          onClick={() => setTab('bookings')}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
            tab === 'bookings' ? 'border-b-2 border-primary text-primary-dark' : 'text-slate-400'
          }`}
        >
          รายการจอง
        </button>
        <button
          onClick={() => setTab('leads')}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
            tab === 'leads' ? 'border-b-2 border-primary text-primary-dark' : 'text-slate-400'
          }`}
        >
          พันธมิตรสมัครใหม่
        </button>
      </div>

      {tab === 'overview' ? (
        <OverviewManager />
      ) : tab === 'partners' ? (
        <PartnersManager />
      ) : tab === 'packages' ? (
        <PackagesManager />
      ) : tab === 'bookings' ? (
        <BookingsManager />
      ) : (
        <PartnerLeadsManager />
      )}
    </div>
  );
}
