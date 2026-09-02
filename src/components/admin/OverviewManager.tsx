'use client';

// src/components/admin/OverviewManager.tsx
//
// PHASE 5 — "Control Center เพิ่ม Task view" tab. Reads
// /api/admin/overview (derived entirely from orders/order_items/
// payments status — no new task table, per the plan). Clicking any
// row goes to the existing order detail page
// (app/admin/orders/[orderId]/page.tsx) where the actual action
// (assign a package, verify a payment) already lives — this tab is a
// "what needs attention" index into that, not a new place to do the
// work itself.

import { useEffect, useState } from 'react';
import Link from 'next/link';

// payments.currency can be THB / LAK / USD (see sql/005_..., the
// chk_payment_currency constraint) — this bucket only ever shows
// payment amounts (see amount/currency below), so it can't assume
// THB like formatTHB does. Same local formatMoney(amount, currency)
// convention already used in quote/[orderNumber]/page.tsx,
// admin/quote/[orderNumber]/page.tsx, and my-trip/[orderNumber]/page.tsx
// — kept local rather than centralized to match that existing pattern.
function formatMoney(amount: number | null, currency: string | null) {
  const value = (amount ?? 0).toLocaleString('th-TH');
  return `${value} ${currency || 'THB'}`;
}

interface OverviewCounts {
  activeJourneys: number;
  readyItems: number;
  unassigned: number;
  awaitingPartnerConfirmation: number;
  paymentPending: number;
}

interface OverviewActionItem {
  kind: 'unassigned' | 'awaiting_partner_confirmation' | 'payment_pending';
  order_item_id: string | null;
  payment_id: string | null;
  order_id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  service_type: string | null;
  amount: number | null;
  currency: string | null;
  created_at: string;
}

const KIND_LABEL: Record<OverviewActionItem['kind'], string> = {
  unassigned: 'รอมอบหมายพาร์ทเนอร์',
  awaiting_partner_confirmation: 'รอพาร์ทเนอร์ยืนยัน',
  payment_pending: 'รอตรวจสอบการชำระเงิน',
};

const KIND_BADGE_CLASS: Record<OverviewActionItem['kind'], string> = {
  unassigned: 'bg-amber-100 text-amber-800',
  awaiting_partner_confirmation: 'bg-sky-100 text-sky-800',
  payment_pending: 'bg-rose-100 text-rose-800',
};

export function OverviewManager() {
  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  const [items, setItems] = useState<OverviewActionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | OverviewActionItem['kind']>('all');

  async function load() {
    setError(null);
    try {
      const res = await fetch('/api/admin/overview');
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'failed to load');
      setCounts(result.counts);
      setItems(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600">
        โหลดข้อมูลไม่สำเร็จ: {error}{' '}
        <button onClick={load} className="underline">
          ลองใหม่
        </button>
      </div>
    );
  }

  if (!counts || !items) {
    return <div className="p-4 text-sm text-slate-400">กำลังโหลด...</div>;
  }

  const visibleItems = filter === 'all' ? items : items.filter((i) => i.kind === filter);

  return (
    <div className="p-4">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard
          label="ทริปที่กำลังดำเนินการ"
          value={counts.activeJourneys}
        />
        <SummaryCard
          label="รอมอบหมายพาร์ทเนอร์"
          value={counts.unassigned}
          tone="warning"
          active={filter === 'unassigned'}
          onClick={() => setFilter('unassigned')}
        />
        <SummaryCard
          label="รอพาร์ทเนอร์ยืนยัน"
          value={counts.awaitingPartnerConfirmation}
          tone="info"
          active={filter === 'awaiting_partner_confirmation'}
          onClick={() => setFilter('awaiting_partner_confirmation')}
        />
        <SummaryCard
          label="รอตรวจสอบการชำระเงิน"
          value={counts.paymentPending}
          tone="danger"
          active={filter === 'payment_pending'}
          onClick={() => setFilter('payment_pending')}
        />
        <SummaryCard label="พร้อมแล้ว" value={counts.readyItems} tone="success" />
      </div>

      {visibleItems.length === 0 ? (
        <div className="rounded-lg border border-slate-100 p-6 text-center text-sm text-slate-400">
          ไม่มีรายการที่ต้องดำเนินการตอนนี้ 🎉
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-100">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">สถานะ</th>
                <th className="px-3 py-2">คำสั่งจอง</th>
                <th className="px-3 py-2">ลูกค้า</th>
                <th className="px-3 py-2">รายละเอียด</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr
                  key={`${item.kind}-${item.order_item_id ?? item.payment_id}`}
                  className="border-t border-slate-100"
                >
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${KIND_BADGE_CLASS[item.kind]}`}
                    >
                      {KIND_LABEL[item.kind]}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium">{item.order_number ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div>{item.customer_name ?? '—'}</div>
                    <div className="text-xs text-slate-400">{item.customer_phone}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {item.service_type ?? (item.amount != null ? formatMoney(item.amount, item.currency) : '—')}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/admin/orders/${item.order_id}`}
                      className="text-primary-dark underline"
                    >
                      เปิดคำสั่งจอง
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'neutral',
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'warning' | 'info' | 'danger' | 'success';
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClass: Record<string, string> = {
    neutral: 'text-slate-700',
    warning: 'text-amber-600',
    info: 'text-sky-600',
    danger: 'text-rose-600',
    success: 'text-emerald-600',
  };

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      onClick={onClick}
      className={`rounded-lg border p-3 text-left ${
        active ? 'border-primary ring-1 ring-primary' : 'border-slate-100'
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className={`text-2xl font-semibold ${toneClass[tone]}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </Wrapper>
  );
}
