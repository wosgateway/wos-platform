'use client';

import { useState } from 'react';
import { AdminGate } from '@/components/admin/AdminGate';
import { PartnersManager } from '@/components/admin/PartnersManager';
import { PackagesManager } from '@/components/admin/PackagesManager';
import { BookingsManager } from '@/components/admin/BookingsManager';

// Not under [locale] — this is an internal Thai-only tool, same as the
// old admin.html / admin-partners.html which never had lang-content spans.
export default function AdminPage() {
  const [tab, setTab] = useState<'partners' | 'packages' | 'bookings'>('partners');

  return (
    <AdminGate>
      <div className="mx-auto max-w-5xl">
        <div className="flex gap-1 border-b border-slate-100 px-4 pt-2">
          <button
            onClick={() => setTab('partners')}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === 'partners' ? 'border-b-2 border-primary text-primary' : 'text-slate-400'
            }`}
          >
            พาร์ทเนอร์
          </button>
          <button
            onClick={() => setTab('packages')}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === 'packages' ? 'border-b-2 border-primary text-primary' : 'text-slate-400'
            }`}
          >
            แพ็กเกจ
          </button>
          <button
            onClick={() => setTab('bookings')}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === 'bookings' ? 'border-b-2 border-primary text-primary' : 'text-slate-400'
            }`}
          >
            รายการจอง
          </button>
        </div>

        {tab === 'partners' ? (
          <PartnersManager />
        ) : tab === 'packages' ? (
          <PackagesManager />
        ) : (
          <BookingsManager />
        )}
      </div>
    </AdminGate>
  );
}
