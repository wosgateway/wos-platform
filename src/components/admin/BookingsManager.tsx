'use client';

// src/components/admin/BookingsManager.tsx
//
// Rewritten for the orders/order_items model (migrations 008-014),
// replacing the old direct `bookings` table query. `customers` and
// `order_items` have no admin-readable RLS policy (see migration 011
// comment), so this reads through /api/admin/orders — a service-role
// API route — instead of the browser Supabase client.
//
// Data shape: 1 order -> many order_items (each item is 'clinic' |
// 'wellness' | 'insurance' | 'hotel' | 'transport', with its own
// partner_id/package_id — see migrations 008/010/014). This replaces
// the old single-row-per-booking model where hotel/transport fields
// lived flat on the `bookings` row itself. Only 'hotel'/'transport'
// items can ever be needs_assignment = true (migration 014); every
// other service_type is always fully resolved at creation time.
//
// Print/WhatsApp/LINE summary logic is ported from the old
// buildBookingSummaryText/printBookingSummary/sendBookingViaWhatsApp
// functions, adapted to read from order.items instead of flat
// booking fields.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatTHB } from '@/lib/format';

// Matches public.orders.status CHECK constraint (migration 008,
// chk_order_status) exactly.
type OrderStatus =
  | 'draft'
  | 'pending_deposit'
  | 'pending_verification'
  | 'deposit_paid'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'refunded';

// Matches public.order_items.service_type CHECK constraint
// (chk_item_service_type) exactly. 'hotel'/'transport' are the only
// two categories create_order_with_items() (migration 014) ever lets
// go unassigned — clinic/wellness/insurance items always resolve to
// a real package_id/partner_id at creation time.
type ServiceType = 'clinic' | 'hotel' | 'transport' | 'wellness' | 'insurance';

type DateRangePreset = 'all' | 'today' | '3d' | '7d' | 'month' | 'custom';

interface OrderItem {
  id: string;
  order_id: string;
  partner_id: string | null;
  package_id: string | null;
  service_type: ServiceType;
  price: number | null;
  deposit_required: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  needs_assignment: boolean;
  hotel_checkout_date: string | null;
  transport_mode: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  package: { id: string; title: string; original_price: number | null; special_price: number | null } | null;
  partner: { id: string; name: string } | null;
}

interface Customer {
  id: string;
  full_name: string;
  phone: string;
  line_id: string | null;
  country: string | null;
}

interface Order {
  id: string;
  order_number: string | null;
  patient_id: string;
  status: OrderStatus;
  notes: string | null;
  attachment_url: string | null;
  total_amount: number | null;
  total_deposit_required: number | null;
  currency: string | null;
  created_at: string;
  payment_access_token: string | null;
  customer: Customer | null;
  items: OrderItem[];
}

interface PickerPackage {
  id: string;
  title: string;
  original_price: number | null;
  special_price: number | null;
  partners: { id: string; name: string } | null;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: '📝 ฉบับร่าง',
  pending_deposit: '⏳ รอชำระมัดจำ',
  pending_verification: '🔍 รอตรวจสลิป',
  deposit_paid: '💰 ชำระมัดจำแล้ว',
  confirmed: '✅ ยืนยันแล้ว',
  checked_in: '🏥 เช็คอินแล้ว',
  completed: '🎉 เสร็จสิ้น',
  cancelled: '❌ ยกเลิก',
  refunded: '💸 คืนเงินแล้ว',
};

const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-500',
  pending_deposit: 'bg-amber-100 text-amber-800',
  pending_verification: 'bg-yellow-100 text-yellow-800',
  deposit_paid: 'bg-sky-100 text-sky-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  checked_in: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-orange-100 text-orange-800',
};

// hotel/transport are the only categories that can be needs_assignment;
// everything else (clinic/wellness/insurance) is "the main service(s)".
function isAddOnItem(item: OrderItem): boolean {
  return item.service_type === 'hotel' || item.service_type === 'transport';
}

function localISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function itemLabel(item: OrderItem): string {
  const partnerName = item.partner?.name;
  const title = item.package?.title;
  return [partnerName, title].filter(Boolean).join(' — ') || 'ยังไม่ระบุ';
}

function itemPrice(item: OrderItem): number {
  if (item.price != null) return Number(item.price);
  if (item.package) return Number(item.package.special_price ?? item.package.original_price ?? 0);
  return 0;
}

function transportDetailLabel(item: OrderItem): string {
  const mode = item.transport_mode || 'one_way';
  const pickup = `${item.scheduled_date || '-'} ${item.scheduled_time || ''}`.trim();
  if (mode === 'round_trip') {
    const ret = `${item.transport_return_date || '-'} ${item.transport_return_time || ''}`.trim();
    return `ไป-กลับ · รับ ${pickup} · ส่งกลับ ${ret}`;
  }
  return `เที่ยวเดียว · รับ ${pickup}`;
}

function buildOrderSummaryText(order: Order): string {
  const mainItems = order.items.filter((i) => !isAddOnItem(i));
  const hotelItem = order.items.find((i) => i.service_type === 'hotel');
  const transportItem = order.items.find((i) => i.service_type === 'transport');
  const statusLabel = STATUS_LABEL[order.status];

  const lines: string[] = [];
  lines.push('🏥 WOS.os — สรุปการจอง');
  lines.push('');
  lines.push(`เลขที่คำสั่งจอง: ${order.order_number || order.id}`);
  lines.push(`ลูกค้า: ${order.customer?.full_name || '-'}`);
  for (const mainItem of mainItems) {
    lines.push(`โปรแกรม: ${itemLabel(mainItem)}`);
    if (mainItem.scheduled_date) {
      lines.push(`วันที่/เวลา: ${mainItem.scheduled_date} ${mainItem.scheduled_time || ''}`.trim());
    }
  }
  if (hotelItem) {
    lines.push(
      `โรงแรม: ${itemLabel(hotelItem)} (เข้าพัก ${hotelItem.scheduled_date || '-'} ถึง ${
        hotelItem.hotel_checkout_date || '-'
      })`
    );
  }
  if (transportItem) {
    lines.push(`รถรับส่ง: ${itemLabel(transportItem)} (${transportDetailLabel(transportItem)})`);
  }
  lines.push('');
  lines.push(`ราคารวม: ${formatTHB(order.total_amount ?? 0)}`);
  lines.push(`สถานะ: ${statusLabel}`);
  lines.push('');
  lines.push('ติดต่อ WOS.os: LINE @vlf9996z | WhatsApp wa.me/message/BVJXBWDYR2UHN1');
  lines.push('TH 085-590-7666 · LA +856 20 9872 4718');
  return lines.join('\n');
}

function toWhatsAppNumber(phone: string | null | undefined, country: string | null | undefined) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) {
    const isLao = !!country && /lao|laos|ลาว/i.test(country);
    digits = (isLao ? '856' : '66') + digits.slice(1);
  }
  return digits;
}

// Same th/lo detection heuristic as toWhatsAppNumber, reused so the
// payment link points at the locale the customer actually reads.
function detectLocale(country: string | null | undefined): 'th' | 'lo' {
  return country && /lao|laos|ลาว/i.test(country) ? 'lo' : 'th';
}

// null when the order hasn't got a token yet (e.g. API route not
// selecting the column) — callers must handle that by disabling UI.
function buildPaymentLink(order: Order): string | null {
  if (!order.payment_access_token || !order.order_number) return null;
  const locale = detectLocale(order.customer?.country);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/${locale}/my-trip/${order.order_number}?token=${encodeURIComponent(order.payment_access_token)}`;
}

function buildPaymentLinkMessage(order: Order, link: string): string {
  const lines: string[] = [];
  lines.push('🏥 WOS.os — ลิงก์ชำระเงิน');
  lines.push('');
  lines.push(`เลขที่คำสั่งจอง: ${order.order_number || order.id}`);
  lines.push(`ลูกค้า: ${order.customer?.full_name || '-'}`);
  lines.push(`ยอดรวม: ${formatTHB(order.total_amount ?? 0)}`);
  lines.push('');
  lines.push('ชำระเงิน/ดูรายละเอียดการจองได้ที่ลิงก์นี้:');
  lines.push(link);
  lines.push('');
  lines.push('ติดต่อ WOS.os: LINE @vlf9996z | WhatsApp wa.me/message/BVJXBWDYR2UHN1');
  lines.push('TH 085-590-7666 · LA +856 20 9872 4718');
  return lines.join('\n');
}

// Separate from sendOrderViaWhatsApp on purpose — that one sends a
// booking summary only, no payment link. This sends the link itself.
function sendPaymentLinkViaWhatsApp(order: Order) {
  const link = buildPaymentLink(order);
  if (!link) return;
  const text = buildPaymentLinkMessage(order, link);
  const number = toWhatsAppNumber(order.customer?.phone, order.customer?.country);
  const url = number
    ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function sendOrderViaWhatsApp(order: Order) {
  const text = buildOrderSummaryText(order);
  const number = toWhatsAppNumber(order.customer?.phone, order.customer?.country);
  const url = number
    ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function sendOrderViaLine(order: Order) {
  const text = buildOrderSummaryText(order);
  const url = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function printOrderSummary(order: Order) {
  const escapeHtml = (str: unknown) => {
    if (str === null || str === undefined) return '';
    return String(str).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
    );
  };

  const SERVICE_TYPE_ROW_LABEL: Record<ServiceType, string> = {
    clinic: 'โปรแกรม (คลินิก/รพ.)',
    wellness: 'โปรแกรม (เวลเนส)',
    insurance: 'ประกัน',
    hotel: 'โรงแรม',
    transport: 'รถรับส่ง',
  };

  const rows: [string, string, string][] = order.items.map((item) => [
    SERVICE_TYPE_ROW_LABEL[item.service_type],
    itemLabel(item) + (item.service_type === 'transport' ? ` · ${transportDetailLabel(item)}` : ''),
    formatTHB(itemPrice(item)),
  ]);

  const statusLabel = STATUS_LABEL[order.status] || order.status;

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
    <meta charset="UTF-8">
    <title>สรุปการจอง — ${escapeHtml(order.customer?.full_name || '')}</title>
    <style>
      body { font-family: 'Prompt', 'Noto Sans Thai', sans-serif; color: #0f172a; padding: 40px; max-width: 640px; margin: 0 auto; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0d7c66; padding-bottom: 16px; margin-bottom: 24px; }
      .brand { font-size: 22px; font-weight: 800; color: #0d7c66; }
      .brand small { display: block; font-size: 12px; font-weight: 500; color: #64748b; }
      .meta { text-align: right; font-size: 12px; color: #64748b; }
      .customer { background: #f0fdf9; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
      .customer div { margin-bottom: 4px; font-size: 14px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
      th { color: #64748b; font-weight: 600; }
      td.price { text-align: right; white-space: nowrap; }
      .total-row td { font-weight: 800; font-size: 16px; border-top: 2px solid #0d7c66; border-bottom: none; }
      .status-badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: #e6f4f1; color: #0a5f4e; }
      .footer { margin-top: 32px; font-size: 11px; color: #94a3b8; text-align: center; }
      @media print { body { padding: 20px; } }
    </style>
    </head>
    <body>
      <div class="header">
        <div class="brand">WOS<span style="color:#f59e0b">.os</span><small>Wellness Operating System — สรุปการจอง</small></div>
        <div class="meta">เลขที่คำสั่งจอง<br>${escapeHtml(order.order_number || order.id)}</div>
      </div>
      <div class="customer">
        <div><b>ลูกค้า:</b> ${escapeHtml(order.customer?.full_name || '-')} ${
          order.customer?.country ? '(' + escapeHtml(order.customer.country) + ')' : ''
        }</div>
        <div><b>ติดต่อ:</b> ${escapeHtml(order.customer?.phone || '-')} ${
          order.customer?.line_id ? '· LINE: ' + escapeHtml(order.customer.line_id) : ''
        }</div>
        <div><b>สถานะ:</b> <span class="status-badge">${escapeHtml(statusLabel)}</span></div>
      </div>
      <table>
        <thead><tr><th>รายการ</th><th>รายละเอียด</th><th style="text-align:right">ราคา</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td><td class="price">${escapeHtml(r[2])}</td></tr>`).join('')}
          <tr class="total-row"><td colspan="2">ราคารวมทั้งหมด</td><td class="price">${escapeHtml(formatTHB(order.total_amount ?? 0))}</td></tr>
        </tbody>
      </table>
      <div class="footer">
        WOS.os by หจก. รอยัล บริตจ์ 99 · LINE @vlf9996z · WhatsApp wa.me/message/BVJXBWDYR2UHN1<br>
        TH 085-590-7666 · LA +856 20 9872 4718 · hello@wos.asia
      </div>
    </body>
    </html>
  `;

  const printWin = window.open('', '_blank');
  if (!printWin) return;
  printWin.document.write(html);
  printWin.document.close();
  printWin.onload = function () {
    printWin.focus();
    printWin.print();
  };
}

export function BookingsManager() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const [hotelPackages, setHotelPackages] = useState<PickerPackage[]>([]);
  const [transportPackages, setTransportPackages] = useState<PickerPackage[]>([]);

  const [savingId, setSavingId] = useState<string | null>(null);
  // Shows a temporary ✅ on the copy-link button after a successful copy.
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Hotel/transport packages still live in the public `packages` table
  // (see PROJECT_STRUCTURE.md decision: `packages` is the single source
  // of truth for programs), so this picker query is unchanged from the
  // old BookingsManager.
  async function loadHotelTransportPackages() {
    try {
      const res = await fetch('/api/admin/packages/pickers?categories=Hotel,Transport', { cache: 'no-store' });
      if (!res.ok) throw new Error('failed to load hotel/transport packages');
      const result = await res.json();
      setHotelPackages(result.hotel ?? []);
      setTransportPackages(result.transport ?? []);
    } catch (e) {
      // Non-fatal — reassignment dropdowns will just be empty.
      console.error(e);
    }
  }

  async function loadOrders() {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/admin/orders', { cache: 'no-store' });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'failed to load orders');
      setOrders(result.orders as Order[]);
    } catch (e) {
      setListError('โหลดข้อมูลไม่สำเร็จ: ' + (e instanceof Error ? e.message : 'unknown error'));
    } finally {
      setLoading(false);
    }
  }

  async function refreshAll() {
    await Promise.all([loadHotelTransportPackages(), loadOrders()]);
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyRangePreset(preset: DateRangePreset) {
    setRangePreset(preset);
    const today = new Date();
    let from = '';
    let to = '';
    if (preset === 'today') {
      from = to = localISODate(today);
    } else if (preset === '3d') {
      from = localISODate(today);
      to = localISODate(addDays(today, 2));
    } else if (preset === '7d') {
      from = localISODate(today);
      to = localISODate(addDays(today, 6));
    } else if (preset === 'month') {
      from = localISODate(new Date(today.getFullYear(), today.getMonth(), 1));
      to = localISODate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    }
    setDateFrom(from);
    setDateTo(to);
  }

  function applyManualDateRange() {
    setRangePreset(!dateFrom && !dateTo ? 'all' : 'custom');
  }

  // Filters by the first non-add-on item's scheduled_date (i.e. the
  // clinic/wellness/insurance service date — hotel/transport are add-ons
  // to that, not the anchor date), same intent as the old
  // bookings.booking_date filter.
  const filtered = useMemo(() => {
    let list = statusFilter === 'all' ? orders : orders.filter((o) => o.status === statusFilter);
    if (dateFrom || dateTo) {
      list = list.filter((o) => {
        const mainDate = o.items.find((i) => !isAddOnItem(i))?.scheduled_date;
        if (!mainDate) return false;
        if (dateFrom && mainDate < dateFrom) return false;
        if (dateTo && mainDate > dateTo) return false;
        return true;
      });
    }
    return list;
  }, [orders, statusFilter, dateFrom, dateTo]);

  async function updateOrderStatus(id: string, newStatus: OrderStatus) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'update failed');
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o)));
    } catch (e) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + (e instanceof Error ? e.message : 'unknown error'));
    } finally {
      setSavingId(null);
    }
  }

  // Reuses the existing /api/admin/order-items/[id]/assign endpoint
  // (already shipped for the pending-assignments screen) instead of a
  // new route, since the contract — { package_id, quantity } — already
  // covers hotel/transport reassignment.
  async function reassignItem(itemId: string, packageId: string) {
    if (!packageId) return;
    setSavingId(itemId);
    try {
      const res = await fetch(`/api/admin/order-items/${itemId}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: packageId, quantity: 1 }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'assignment failed');
      await loadOrders();
    } catch (e) {
      alert('เปลี่ยนแพ็กเกจไม่สำเร็จ: ' + (e instanceof Error ? e.message : 'unknown error'));
    } finally {
      setSavingId(null);
    }
  }

  // Clipboard API needs a secure context (https/localhost); falls back
  // to a prompt() the admin can manually Ctrl/Cmd+C from on older
  // browsers or plain-http deployments.
  async function copyPaymentLink(order: Order) {
    const link = buildPaymentLink(order);
    if (!link) return;
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('clipboard api unavailable');
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt('คัดลอกลิงก์นี้ด้วยตนเอง (Ctrl/Cmd+C แล้ว Enter):', link);
    }
    setCopiedId(order.id);
    setTimeout(() => setCopiedId((cur) => (cur === order.id ? null : cur)), 1500);
  }

  const statusPills: { value: 'all' | OrderStatus; label: string }[] = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'pending_deposit', label: STATUS_LABEL.pending_deposit },
    { value: 'pending_verification', label: STATUS_LABEL.pending_verification },
    { value: 'deposit_paid', label: STATUS_LABEL.deposit_paid },
    { value: 'confirmed', label: STATUS_LABEL.confirmed },
    { value: 'checked_in', label: STATUS_LABEL.checked_in },
    { value: 'completed', label: STATUS_LABEL.completed },
    { value: 'cancelled', label: STATUS_LABEL.cancelled },
    { value: 'refunded', label: STATUS_LABEL.refunded },
  ];
  const rangePills: { value: DateRangePreset; label: string }[] = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'today', label: 'วันนี้' },
    { value: '3d', label: 'อีก 3 วัน' },
    { value: '7d', label: 'อีก 7 วัน' },
    { value: 'month', label: 'เดือนนี้' },
  ];

  const pillClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? 'border-slate-800 bg-slate-800 text-white'
        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
    }`;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">🏨 รายการจอง ({orders.length})</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            ทั้งหมด {orders.length} รายการ · แสดง {filtered.length} รายการ
          </p>
        </div>
        <button onClick={refreshAll} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
          🔄 รีเฟรช
        </button>
      </div>

      {listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {listError}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {statusPills.map((p) => (
          <button key={p.value} onClick={() => setStatusFilter(p.value)} className={pillClass(statusFilter === p.value)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2.5">
        <span className="pl-1 text-xs font-medium text-slate-500">📅 ช่วงวันที่ใช้บริการ:</span>
        {rangePills.map((p) => (
          <button key={p.value} onClick={() => applyRangePreset(p.value)} className={pillClass(rangePreset === p.value)}>
            {p.label}
          </button>
        ))}
        <span className="hidden text-slate-300 sm:inline">|</span>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
        />
        <span className="text-xs text-slate-400">ถึง</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
        />
        <button
          onClick={applyManualDateRange}
          className="rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-light"
        >
          ใช้ช่วงนี้
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
          📭 ยังไม่มีรายการจองในหมวดนี้
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-100 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">เลขที่ / วันที่แจ้ง</th>
                <th className="px-4 py-3 font-semibold">ลูกค้า</th>
                <th className="px-4 py-3 font-semibold">ติดต่อ</th>
                <th className="px-4 py-3 font-semibold">โปรแกรม</th>
                <th className="px-4 py-3 font-semibold">โรงแรม / รถรับส่ง</th>
                <th className="px-4 py-3 font-semibold">ราคารวม</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                <th className="px-4 py-3 font-semibold">ส่งให้ลูกค้า</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => {
                const mainItems = order.items.filter((i) => !isAddOnItem(i));
                const hotelItem = order.items.find((i) => i.service_type === 'hotel');
                const transportItem = order.items.find((i) => i.service_type === 'transport');
                const createdAt = order.created_at ? new Date(order.created_at).toLocaleString('th-TH') : '-';
                const busy = savingId === order.id;

                return (
                  <tr
                    key={order.id}
                    onClick={(e) => {
                      // อย่า navigate ถ้าคลิกโดน select/button/a ในแถว
                      // (dropdown เลือกโรงแรม, ปุ่มพิมพ์/ส่ง WhatsApp/LINE ฯลฯ)
                      const target = e.target as HTMLElement;
                      if (target.closest('select, button, a')) return;
                      router.push(`/admin/orders/${order.id}`);
                    }}
                    className="cursor-pointer border-b border-slate-50 align-top hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="font-medium text-slate-800 hover:text-primary hover:underline"
                      >
                        {order.order_number || order.id.slice(0, 8)}
                      </Link>
                      <div className="text-xs text-slate-400">{createdAt}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{order.customer?.full_name || '-'}</div>
                      <div className="text-xs text-slate-500">{order.customer?.country || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{order.customer?.phone || '-'}</div>
                      {order.customer?.line_id ? (
                        <div className="text-xs text-slate-400">LINE: {order.customer.line_id}</div>
                      ) : null}
                      {order.attachment_url ? (
                        <a
                          href={order.attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          📎 ไฟล์แนบ
                        </a>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {mainItems.length === 0 ? (
                        '-'
                      ) : (
                        mainItems.map((item) => (
                          <div key={item.id} className="mb-1.5 last:mb-0">
                            <div className="font-medium text-slate-800">{itemLabel(item)}</div>
                            <div className="text-xs text-slate-500">
                              {item.scheduled_date || '-'} {item.scheduled_time || ''}
                            </div>
                          </div>
                        ))
                      )}
                    </td>
                    <td className="min-w-[180px] px-4 py-3 text-xs text-slate-600">
                      {!hotelItem && !transportItem ? (
                        '-'
                      ) : (
                        <>
                          {transportItem ? (
                            <div className="mb-1.5">
                              <div className="flex items-center gap-1 text-xs">
                                <span>🚗</span>
                                <span
                                  className={`font-medium ${
                                    transportItem.partner ? 'text-slate-700' : 'text-amber-600'
                                  }`}
                                >
                                  {itemLabel(transportItem)}
                                </span>
                              </div>
                              <div className="ml-4 text-xs text-slate-500">
                                {transportDetailLabel(transportItem)}
                              </div>
                              {itemPrice(transportItem) ? (
                                <div className="ml-4 text-xs text-slate-400">
                                  {formatTHB(itemPrice(transportItem))}
                                </div>
                              ) : null}
                              <select
                                disabled={busy}
                                value=""
                                onChange={(e) => reassignItem(transportItem.id, e.target.value)}
                                className="mt-0.5 rounded border border-slate-200 px-1.5 py-1 text-xs"
                              >
                                <option value="">-- เปลี่ยน/เลือกแพ็กเกจรถ --</option>
                                {transportPackages.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {(p.partners ? p.partners.name + ' — ' : '') + p.title}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                          {hotelItem ? (
                            <div>
                              <div className="flex items-center gap-1 text-xs">
                                <span>🏨</span>
                                <span
                                  className={`font-medium ${
                                    hotelItem.partner ? 'text-slate-700' : 'text-amber-600'
                                  }`}
                                >
                                  {itemLabel(hotelItem)}
                                </span>
                              </div>
                              <div className="ml-4 text-xs text-slate-500">
                                {hotelItem.scheduled_date || '-'} ถึง {hotelItem.hotel_checkout_date || '-'}
                              </div>
                              {itemPrice(hotelItem) ? (
                                <div className="ml-4 text-xs text-slate-400">{formatTHB(itemPrice(hotelItem))}</div>
                              ) : null}
                              <select
                                disabled={busy}
                                value=""
                                onChange={(e) => reassignItem(hotelItem.id, e.target.value)}
                                className="mt-0.5 rounded border border-slate-200 px-1.5 py-1 text-xs"
                              >
                                <option value="">-- เปลี่ยน/เลือกแพ็กเกจโรงแรม --</option>
                                {hotelPackages.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {(p.partners ? p.partners.name + ' — ' : '') + p.title}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="font-bold text-slate-900">{formatTHB(order.total_amount ?? 0)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        disabled={busy}
                        value={order.status}
                        onChange={(e) => updateOrderStatus(order.id, e.target.value as OrderStatus)}
                        className={`rounded-lg border-0 px-2 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[order.status]}`}
                      >
                        <option value="pending_deposit">{STATUS_LABEL.pending_deposit}</option>
                        <option value="pending_verification">{STATUS_LABEL.pending_verification}</option>
                        <option value="deposit_paid">{STATUS_LABEL.deposit_paid}</option>
                        <option value="confirmed">{STATUS_LABEL.confirmed}</option>
                        <option value="checked_in">{STATUS_LABEL.checked_in}</option>
                        <option value="completed">{STATUS_LABEL.completed}</option>
                        <option value="cancelled">{STATUS_LABEL.cancelled}</option>
                        <option value="refunded">{STATUS_LABEL.refunded}</option>
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => printOrderSummary(order)}
                          title="พิมพ์สรุป"
                          className="rounded-lg border border-slate-200 px-2 py-1 text-sm hover:border-primary hover:bg-primary-light"
                        >
                          🖨️
                        </button>
                        <button
                          onClick={() => sendOrderViaWhatsApp(order)}
                          title="ส่งสรุปการจองทาง WhatsApp"
                          className="rounded-lg border border-slate-200 px-2 py-1 text-sm hover:border-primary hover:bg-primary-light"
                        >
                          📱
                        </button>
                        <button
                          onClick={() => sendOrderViaLine(order)}
                          title="ส่งทาง LINE"
                          className="rounded-lg border border-slate-200 px-2 py-1 text-sm hover:border-primary hover:bg-primary-light"
                        >
                          💬
                        </button>
                        <button
                          onClick={() => copyPaymentLink(order)}
                          disabled={!order.payment_access_token}
                          title={
                            order.payment_access_token
                              ? 'คัดลอกลิงก์ชำระเงิน'
                              : 'ยังไม่มีลิงก์ชำระเงิน (payment_access_token ไม่มีค่า)'
                          }
                          className="rounded-lg border border-slate-200 px-2 py-1 text-sm hover:border-primary hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:bg-transparent"
                        >
                          {copiedId === order.id ? '✅' : '🔗'}
                        </button>
                        <button
                          onClick={() => sendPaymentLinkViaWhatsApp(order)}
                          disabled={!order.payment_access_token}
                          title={
                            order.payment_access_token
                              ? 'ส่งลิงก์ชำระเงินทาง WhatsApp'
                              : 'ยังไม่มีลิงก์ชำระเงิน (payment_access_token ไม่มีค่า)'
                          }
                          className="rounded-lg border border-slate-200 px-2 py-1 text-sm hover:border-primary hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:bg-transparent"
                        >
                          💳
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
