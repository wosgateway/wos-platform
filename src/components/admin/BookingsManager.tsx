'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';

// Ported 1:1 from the bookings tab in the old admin.html (loadBookings,
// renderBookings, bookingsRowHtml, buildBookingSummaryText, printBookingSummary,
// sendBookingViaWhatsApp/Line, updateBookingStatus/PartnerField). Same tables,
// same joins, same pricing math — just typed React state instead of manual
// DOM re-rendering.

type BookingStatus = 'pending' | 'confirmed' | 'cancelled';
type TransportMode = 'one_way' | 'round_trip' | 'daily' | null;
type DateRangePreset = 'all' | 'today' | '3d' | '7d' | 'month' | 'custom';

interface PackageRef {
  title: string;
  original_price: number | null;
  special_price: number | null;
  partners: { name: string } | null;
}

interface Booking {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_line: string | null;
  country: string | null;
  booking_date: string | null;
  booking_time: string | null;
  need_transport: boolean;
  need_hotel: boolean;
  hotel_package_id: string | null;
  transport_package_id: string | null;
  hotel_checkin_date: string | null;
  hotel_nights: number | null;
  transport_mode: TransportMode;
  transport_pickup_date: string | null;
  transport_pickup_time: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  transport_days: number | null;
  attachment_url: string | null;
  status: BookingStatus;
  created_at: string;
  packages: PackageRef | null;
  hotel_package: PackageRef | null;
  transport_package: PackageRef | null;
}

interface PickerPackage {
  id: string;
  title: string;
  original_price: number | null;
  special_price: number | null;
  partners: { id: string; name: string; category: string; status: string } | null;
}

const BOOKINGS_SELECT = `
  id, customer_name, customer_phone, customer_line, country,
  booking_date, booking_time, need_transport, need_hotel,
  hotel_package_id, transport_package_id,
  hotel_checkin_date, hotel_nights,
  transport_mode, transport_pickup_date, transport_pickup_time,
  transport_return_date, transport_return_time, transport_days,
  attachment_url, status, created_at,
  packages!bookings_package_id_fkey ( title, original_price, special_price, partners ( name ) ),
  hotel_package:hotel_package_id ( title, original_price, special_price, partners ( name ) ),
  transport_package:transport_package_id ( title, original_price, special_price, partners ( name ) )
`;

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'รอดำเนินการ',
  confirmed: 'ยืนยันแล้ว',
  cancelled: 'ยกเลิก',
};

const STATUS_BADGE_CLASS: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
};

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

function effectivePrice(pkg: PackageRef | null) {
  if (!pkg) return 0;
  return Number(pkg.special_price ?? pkg.original_price ?? 0);
}

// Hotel package price is a per-night rate — multiply by nights stayed
function hotelTotalPrice(b: Booking) {
  if (!b.need_hotel) return 0;
  const nights = Math.max(1, Number(b.hotel_nights) || 1);
  return effectivePrice(b.hotel_package) * nights;
}

// Transport package price is a flat rate for one_way/round_trip,
// or a per-day rate multiplied by transport_days when mode is 'daily'
function transportTotalPrice(b: Booking) {
  if (!b.need_transport) return 0;
  const unit = effectivePrice(b.transport_package);
  if (b.transport_mode === 'daily') {
    return unit * Math.max(1, Number(b.transport_days) || 1);
  }
  return unit;
}

// Short label describing the transport arrangement (mode + dates)
function transportDetailLabel(b: Booking) {
  if (!b.need_transport) return null;
  const mode = b.transport_mode || 'one_way';
  const pickup = `${b.transport_pickup_date || '-'} ${b.transport_pickup_time || ''}`.trim();
  if (mode === 'round_trip') {
    const ret = `${b.transport_return_date || '-'} ${b.transport_return_time || ''}`.trim();
    return `ไป-กลับ · รับ ${pickup} · ส่งกลับ ${ret}`;
  }
  if (mode === 'daily') {
    const days = Math.max(1, Number(b.transport_days) || 1);
    return `เหมาต่อวัน ${days} วัน · เริ่ม ${pickup}`;
  }
  return `เที่ยวเดียว · รับ ${pickup}`;
}

// Build a plain-text booking summary (used for WhatsApp/LINE share + print)
function buildBookingSummaryText(b: Booking) {
  const pkgTitle = b.packages ? b.packages.title : null;
  const partnerName = b.packages?.partners ? b.packages.partners.name : null;
  const mainPrice = effectivePrice(b.packages);
  const hotelPrice = hotelTotalPrice(b);
  const transportPrice = transportTotalPrice(b);
  const totalPrice = mainPrice + hotelPrice + transportPrice;
  const statusLabel = STATUS_LABEL[b.status] + (b.status === 'confirmed' ? ' ✅' : b.status === 'cancelled' ? ' ❌' : '');

  const lines: string[] = [];
  lines.push('🏥 WOS.os — สรุปการจอง');
  lines.push('');
  lines.push(`ลูกค้า: ${b.customer_name || '-'}`);
  lines.push(`วันที่/เวลา: ${b.booking_date || '-'} ${b.booking_time || ''}`.trim());
  if (partnerName || pkgTitle) lines.push(`โปรแกรม: ${[partnerName, pkgTitle].filter(Boolean).join(' — ')}`);
  if (b.need_hotel && b.hotel_package) {
    const nights = Math.max(1, Number(b.hotel_nights) || 1);
    lines.push(
      `โรงแรม: ${[b.hotel_package.partners?.name, b.hotel_package.title].filter(Boolean).join(' — ')} (เข้าพัก ${
        b.hotel_checkin_date || '-'
      } · ${nights} คืน)`
    );
  }
  if (b.need_transport && b.transport_package) {
    lines.push(
      `รถรับส่ง: ${[b.transport_package.partners?.name, b.transport_package.title].filter(Boolean).join(' — ')} (${transportDetailLabel(b)})`
    );
  }
  lines.push('');
  lines.push(`ราคารวม: ${formatTHB(totalPrice)}`);
  lines.push(`สถานะ: ${statusLabel}`);
  lines.push('');
  lines.push('ติดต่อ WOS.os: LINE @vlf9996z | WhatsApp wa.me/message/BVJXBWDYR2UHN1');
  lines.push('TH 085-590-7666 · LA +856 20 9872 4718');
  return lines.join('\n');
}

// Normalize a customer phone number to WhatsApp's international-digits-only
// format. Assumes Thai numbers by default (leading 0 -> 66); leaves
// already-international numbers alone.
function toWhatsAppNumber(phone: string | null, country: string | null) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) {
    const isLao = !!country && /lao|laos|ลาว/i.test(country);
    digits = (isLao ? '856' : '66') + digits.slice(1);
  }
  return digits;
}

function sendBookingViaWhatsApp(b: Booking) {
  const text = buildBookingSummaryText(b);
  const number = toWhatsAppNumber(b.customer_phone, b.country);
  const url = number
    ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function sendBookingViaLine(b: Booking) {
  const text = buildBookingSummaryText(b);
  // LINE has no public deep-link to message a specific personal ID directly;
  // this opens LINE's share sheet with the summary pre-filled so the admin
  // picks the customer's chat themselves.
  const url = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function printBookingSummary(b: Booking) {
  const pkgTitle = b.packages ? b.packages.title : null;
  const partnerName = b.packages?.partners ? b.packages.partners.name : null;
  const mainPrice = effectivePrice(b.packages);
  const hotelPrice = hotelTotalPrice(b);
  const transportPrice = transportTotalPrice(b);
  const totalPrice = mainPrice + hotelPrice + transportPrice;
  const statusLabel = STATUS_LABEL[b.status] || b.status;

  const escapeHtml = (str: unknown) => {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  };

  const rows: [string, string, string][] = [];
  if (partnerName || pkgTitle) {
    rows.push(['โปรแกรม', [partnerName, pkgTitle].filter(Boolean).join(' — '), formatTHB(mainPrice)]);
  }
  if (b.need_hotel && b.hotel_package) {
    const nights = Math.max(1, Number(b.hotel_nights) || 1);
    rows.push([
      'โรงแรม',
      `${[b.hotel_package.partners?.name, b.hotel_package.title].filter(Boolean).join(' — ')} · เข้าพัก ${
        b.hotel_checkin_date || '-'
      } (${nights} คืน)`,
      formatTHB(hotelPrice),
    ]);
  }
  if (b.need_transport && b.transport_package) {
    rows.push([
      'รถรับส่ง',
      `${[b.transport_package.partners?.name, b.transport_package.title].filter(Boolean).join(' — ')} · ${transportDetailLabel(b)}`,
      formatTHB(transportPrice),
    ]);
  }

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
    <meta charset="UTF-8">
    <title>สรุปการจอง — ${escapeHtml(b.customer_name || '')}</title>
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
        <div class="meta">วันที่ออกเอกสาร<br>${new Date().toLocaleDateString('th-TH')}</div>
      </div>
      <div class="customer">
        <div><b>ลูกค้า:</b> ${escapeHtml(b.customer_name || '-')} ${b.country ? '(' + escapeHtml(b.country) + ')' : ''}</div>
        <div><b>ติดต่อ:</b> ${escapeHtml(b.customer_phone || '-')} ${b.customer_line ? '· LINE: ' + escapeHtml(b.customer_line) : ''}</div>
        <div><b>วันที่ใช้บริการ:</b> ${escapeHtml(b.booking_date || '-')} ${escapeHtml(b.booking_time || '')}</div>
        <div><b>สถานะ:</b> <span class="status-badge">${escapeHtml(statusLabel)}</span></div>
      </div>
      <table>
        <thead><tr><th>รายการ</th><th>รายละเอียด</th><th style="text-align:right">ราคา</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td><td class="price">${escapeHtml(r[2])}</td></tr>`).join('')}
          <tr class="total-row"><td colspan="2">ราคารวมทั้งหมด</td><td class="price">${escapeHtml(formatTHB(totalPrice))}</td></tr>
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
  const supabase = createClient();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | BookingStatus>('all');
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const [hotelPackages, setHotelPackages] = useState<PickerPackage[]>([]);
  const [transportPackages, setTransportPackages] = useState<PickerPackage[]>([]);

  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadHotelTransportPackages() {
    const [hotelRes, transportRes] = await Promise.all([
      supabase
        .from('packages')
        .select('id, title, original_price, special_price, partners!inner(id, name, category, status)')
        .eq('partners.category', 'Hotel')
        .eq('partners.status', 'active')
        .order('title'),
      supabase
        .from('packages')
        .select('id, title, original_price, special_price, partners!inner(id, name, category, status)')
        .eq('partners.category', 'Transport')
        .eq('partners.status', 'active')
        .order('title'),
    ]);
    setHotelPackages((hotelRes.data ?? []) as unknown as PickerPackage[]);
    setTransportPackages((transportRes.data ?? []) as unknown as PickerPackage[]);
  }

  async function loadBookings() {
    setLoading(true);
    setListError(null);
    const { data, error } = await supabase
      .from('bookings')
      .select(BOOKINGS_SELECT)
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) {
      setListError('โหลดข้อมูลไม่สำเร็จ: ' + error.message);
      return;
    }
    setBookings((data ?? []) as unknown as Booking[]);
  }

  async function refreshAll() {
    await Promise.all([loadHotelTransportPackages(), loadBookings()]);
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

  const filtered = useMemo(() => {
    let list = statusFilter === 'all' ? bookings : bookings.filter((b) => b.status === statusFilter);
    if (dateFrom || dateTo) {
      list = list.filter((b) => {
        if (!b.booking_date) return false;
        if (dateFrom && b.booking_date < dateFrom) return false;
        if (dateTo && b.booking_date > dateTo) return false;
        return true;
      });
    }
    return list;
  }, [bookings, statusFilter, dateFrom, dateTo]);

  async function updateBookingStatus(id: string, newStatus: BookingStatus) {
    setSavingId(id);
    const { error } = await supabase.from('bookings').update({ status: newStatus }).eq('id', id);
    setSavingId(null);
    if (error) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + error.message);
      return;
    }
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: newStatus } : b)));
  }

  async function updateBookingPartnerField(
    id: string,
    field: 'hotel_package_id' | 'transport_package_id',
    value: string
  ) {
    setSavingId(id);
    const { error } = await supabase
      .from('bookings')
      .update({ [field]: value || null })
      .eq('id', id);
    setSavingId(null);
    if (error) {
      alert('อัปเดตไม่สำเร็จ: ' + error.message);
      return;
    }
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value || null } : b)));
  }

  const statusPills: { value: 'all' | BookingStatus; label: string }[] = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'pending', label: '⏳ รอดำเนินการ' },
    { value: 'confirmed', label: '✅ ยืนยันแล้ว' },
    { value: 'cancelled', label: '❌ ยกเลิก' },
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
      active ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
    }`;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">🏨 รายการจองแพ็กเกจ ({bookings.length})</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            ทั้งหมด {bookings.length} รายการ · แสดง {filtered.length} รายการ
          </p>
        </div>
        <button onClick={refreshAll} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
          🔄 รีเฟรช
        </button>
      </div>

      {listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{listError}</div>
      ) : null}

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {statusPills.map((p) => (
          <button key={p.value} onClick={() => setStatusFilter(p.value)} className={pillClass(statusFilter === p.value)}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Date range filter — filters by booking_date (วันที่ใช้บริการ) */}
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
                <th className="px-4 py-3 font-semibold">วันที่/เวลาจอง</th>
                <th className="px-4 py-3 font-semibold">ลูกค้า</th>
                <th className="px-4 py-3 font-semibold">ติดต่อ</th>
                <th className="px-4 py-3 font-semibold">โปรแกรม / พาร์ทเนอร์</th>
                <th className="px-4 py-3 font-semibold">โรงแรม / รถรับส่ง</th>
                <th className="px-4 py-3 font-semibold">ราคารวม</th>
                <th className="px-4 py-3 font-semibold">แจ้งเมื่อ</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                <th className="px-4 py-3 font-semibold">ส่งให้ลูกค้า</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const pkgTitle = b.packages ? b.packages.title : '-';
                const partnerName = b.packages?.partners ? b.packages.partners.name : '-';
                const createdAt = b.created_at ? new Date(b.created_at).toLocaleString('th-TH') : '-';
                const mainPrice = effectivePrice(b.packages);
                const hotelPrice = hotelTotalPrice(b);
                const transportPrice = transportTotalPrice(b);
                const totalPrice = mainPrice + hotelPrice + transportPrice;
                const transportLabel = b.transport_package
                  ? `${b.transport_package.partners ? b.transport_package.partners.name + ' — ' : ''}${b.transport_package.title}`
                  : null;
                const hotelLabel = b.hotel_package
                  ? `${b.hotel_package.partners ? b.hotel_package.partners.name + ' — ' : ''}${b.hotel_package.title}`
                  : null;
                const transportDetail = transportDetailLabel(b);
                const busy = savingId === b.id;

                return (
                  <tr key={b.id} className="border-b border-slate-50 align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="font-medium text-slate-800">{b.booking_date || '-'}</div>
                      <div className="text-xs text-slate-500">{b.booking_time || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{b.customer_name}</div>
                      <div className="text-xs text-slate-500">{b.country || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{b.customer_phone}</div>
                      {b.customer_line ? <div className="text-xs text-slate-400">LINE: {b.customer_line}</div> : null}
                      {b.attachment_url ? (
                        <a
                          href={b.attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          📎 ไฟล์แนบ
                        </a>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{pkgTitle}</div>
                      <div className="text-xs text-slate-500">{partnerName}</div>
                    </td>
                    <td className="min-w-[180px] px-4 py-3 text-xs text-slate-600">
                      {b.need_transport || b.need_hotel ? (
                        <>
                          <div className="mb-1.5 border-b border-slate-100 pb-1.5 text-xs text-slate-400">
                            📅 ใช้วันที่ {b.booking_date || '-'} {b.booking_time || '-'}
                          </div>
                          {b.need_transport ? (
                            <div className="mb-1.5">
                              <div className="flex items-center gap-1 text-xs">
                                <span>🚗</span>
                                <span className={`font-medium ${transportLabel ? 'text-slate-700' : 'text-amber-600'}`}>
                                  {transportLabel || 'ยังไม่ระบุ'}
                                </span>
                              </div>
                              {transportDetail ? <div className="ml-4 text-xs text-slate-500">{transportDetail}</div> : null}
                              {transportPrice ? (
                                <div className="ml-4 text-xs text-slate-400">{formatTHB(transportPrice)}</div>
                              ) : null}
                              <select
                                disabled={busy}
                                value={b.transport_package_id || ''}
                                onChange={(e) => updateBookingPartnerField(b.id, 'transport_package_id', e.target.value)}
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
                          {b.need_hotel ? (
                            <div>
                              <div className="flex items-center gap-1 text-xs">
                                <span>🏨</span>
                                <span className={`font-medium ${hotelLabel ? 'text-slate-700' : 'text-amber-600'}`}>
                                  {hotelLabel || 'ยังไม่ระบุ'}
                                </span>
                              </div>
                              <div className="ml-4 text-xs text-slate-500">
                                {b.hotel_checkin_date || '-'} · {Math.max(1, Number(b.hotel_nights) || 1)} คืน
                              </div>
                              {hotelPrice ? <div className="ml-4 text-xs text-slate-400">{formatTHB(hotelPrice)}</div> : null}
                              <select
                                disabled={busy}
                                value={b.hotel_package_id || ''}
                                onChange={(e) => updateBookingPartnerField(b.id, 'hotel_package_id', e.target.value)}
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
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="font-bold text-slate-900">{formatTHB(totalPrice)}</div>
                      {hotelPrice || transportPrice ? (
                        <div className="text-xs text-slate-400">โปรแกรม {formatTHB(mainPrice)}</div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{createdAt}</td>
                    <td className="px-4 py-3">
                      <select
                        disabled={busy}
                        value={b.status}
                        onChange={(e) => updateBookingStatus(b.id, e.target.value as BookingStatus)}
                        className={`rounded-lg border-0 px-2 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[b.status]}`}
                      >
                        <option value="pending">⏳ รอดำเนินการ</option>
                        <option value="confirmed">✅ ยืนยันแล้ว</option>
                        <option value="cancelled">❌ ยกเลิก</option>
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => printBookingSummary(b)}
                          title="พิมพ์สรุป"
                          className="rounded-lg border border-slate-200 px-2 py-1 text-sm hover:border-primary hover:bg-primary-light"
                        >
                          🖨️
                        </button>
                        <button
                          onClick={() => sendBookingViaWhatsApp(b)}
                          title="ส่งทาง WhatsApp"
                          className="rounded-lg border border-slate-200 px-2 py-1 text-sm hover:border-primary hover:bg-primary-light"
                        >
                          📱
                        </button>
                        <button
                          onClick={() => sendBookingViaLine(b)}
                          title="ส่งทาง LINE"
                          className="rounded-lg border border-slate-200 px-2 py-1 text-sm hover:border-primary hover:bg-primary-light"
                        >
                          💬
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
