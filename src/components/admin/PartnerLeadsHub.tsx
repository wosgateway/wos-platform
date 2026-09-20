'use client';

// src/components/admin/PartnerLeadsHub.tsx
//
// Mounted as the "พันธมิตรสมัครใหม่" (leads) tab in /admin. Two
// registration entry points write to two different tables with no
// overlap — see each manager's own header comment for why:
//   - /partner/apply    -> public.cases              -> PartnerLeadsManager.tsx
//   - /become-partner   -> public.partner_applications -> PartnerApplicationsManager.tsx
// This just switches between them; each manager fetches its own data
// independently.

import { useState } from 'react';
import { PartnerLeadsManager } from './PartnerLeadsManager';
import { PartnerApplicationsManager } from './PartnerApplicationsManager';

type Source = 'apply' | 'become-partner';

export function PartnerLeadsHub() {
  const [source, setSource] = useState<Source>('apply');

  const pillClass = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
      active ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
    }`;

  return (
    <div>
      <div className="flex flex-wrap gap-2 px-4 pt-4">
        <button onClick={() => setSource('apply')} className={pillClass(source === 'apply')}>
          จาก /partner/apply
        </button>
        <button onClick={() => setSource('become-partner')} className={pillClass(source === 'become-partner')}>
          จาก /become-partner
        </button>
      </div>
      {source === 'apply' ? <PartnerLeadsManager /> : <PartnerApplicationsManager />}
    </div>
  );
}
