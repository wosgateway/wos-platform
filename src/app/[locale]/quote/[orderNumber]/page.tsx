'use client';

// src/app/[locale]/quote/[orderNumber]/page.tsx
//
// Public page a customer opens from the WhatsApp/LINE/SMS link sent by
// send-quotation/route.tsx. Shows the program + total/deposit, and lets
// the customer confirm the order (draft -> pending_deposit). No payment
// happens here yet — admin follows up with the customer to collect the
// deposit afterward (Phase 3).
//
// Single-package-per-order for now (per current data model) — the
// items list below already loops, so if the order model grows to
// support multiple selectable package options later, this page's
// fetch/display logic won't need to change, only the confirm action
// would need to carry which item(s) were chosen.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type ServiceType = 'clinic' | 'hotel' | 'transport' | 'wellness' | 'insurance';

interface QuoteItem {
  id: string;
  service_type: ServiceType;
  price: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  package: { title: string } | null;
  partner: { name: string } | null;
}

interface Quote {
  order_number: string;
  status: string;
  currency: string | null;
  total_amount: number | null;
  total_deposit_required: number | null;
  total_deposit_paid: number | null;
  total_balance_remaining: number | null;
  customer_name: string | null;
  items: QuoteItem[];
}

const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  clinic: '🏥 คลินิก/โรงพยาบาล',
  wellness: '🧘 เวลเนส',
  insurance: '📄 ประกัน',
  hotel: '🏨 โรงแรม',
  transport: '🚗 รถรับส่ง',
};

function formatMoney(amount: number | null, currency: string | null) {
  const value = (amount ?? 0).toLocaleString('th-TH');
  return `${value} ${currency || 'THB'}`;
}

function itemLabel(item: QuoteItem): string {
  return [item.partner?.name, item.package?.title].filter(Boolean).join(' — ') || 'โปรแกรม';
}

export default function QuotePage() {
  const params = useParams();
  const orderNumber = params?.orderNumber as string;

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/quote/${orderNumber}`);
        const result = await res.json();
        if (!res.ok) throw new Error(result?.error ?? 'โหลดข้อมูลไม่สำเร็จ');
        setQuote(result.order);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown error');
      } finally {
        setLoading(false);
      }
    }
    if (orderNumber) load();
  }, [orderNumber]);

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/quote/${orderNumber}/confirm`, { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'ยืนยันไม่สำเร็จ');
      setConfirmed(true);
      setQuote((prev) => (prev ? { ...prev, status: 'pending_deposit' } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (error && !quote) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      </div>
    );
  }

  if (!quote) return null;

  const canConfirm = quote.status === 'draft' && !confirmed;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">🏥 ใบเสนอราคา</h1>
        <p className="mt-1 text-sm text-slate-500">
          เลขที่: {quote.order_number}
          {quote.customer_name ? ` · คุณ${quote.customer_name}` : ''}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 p-5 pb-3 text-sm font-bold text-slate-700">รายการ</h2>
        <div className="divide-y divide-slate-50">
          {quote.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-5">
              <div>
                <div className="text-xs text-slate-400">{SERVICE_TYPE_LABEL[item.service_type]}</div>
                <div className="font-medium text-slate-800">{itemLabel(item)}</div>
                {item.scheduled_date ? (
                  <div className="text-xs text-slate-500">
                    {item.scheduled_date} {item.scheduled_time || ''}
                  </div>
                ) : null}
              </div>
              <div className="font-semibold text-slate-900">
                {formatMoney(item.price, quote.currency)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">ยอดรวมทั้งหมด</span>
          <span className="font-semibold text-slate-900">{formatMoney(quote.total_amount, quote.currency)}</span>
        </div>
        <div className="mt-1.5 flex justify-between text-sm">
          <span className="text-slate-500">มัดจำที่ต้องชำระ</span>
          <span className="font-semibold text-primary">
            {formatMoney(quote.total_deposit_required, quote.currency)}
          </span>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>
      ) : null}

      {confirmed || quote.status !== 'draft' ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center text-sm text-emerald-700">
          ✅ ยืนยันรายการแล้ว — ทีมงานจะติดต่อกลับเพื่อแจ้งขั้นตอนการชำระมัดจำ
        </div>
      ) : (
        <button
          onClick={handleConfirm}
          disabled={!canConfirm || confirming}
          className="w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-white disabled:opacity-60"
        >
          {confirming ? 'กำลังยืนยัน...' : '✅ ยืนยันรายการนี้'}
        </button>
      )}

      <p className="text-center text-xs text-slate-400">
        มีคำถาม? ติดต่อ LINE @vlf9996z · WhatsApp wa.me/message/BVJXBWDYR2UHN1
      </p>
    </div>
  );
}
