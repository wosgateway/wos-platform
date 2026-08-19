// src/components/partner/BookingsList.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { formatTHB } from '@/lib/format';
import { BookingDetailModal } from './BookingDetailModal';
import { ExportBookings } from './ExportBookings';

// order_items.status enum จริง (migration 008) — ไม่มี 'in_progress'
// เหมือน partner_bookings เดิม เพิ่ม 'checked_in' และ 'refunded' แทน
type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'refunded';

interface Booking {
  id: string; // order_items.id
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_line: string | null;
  service_type: string;
  status: BookingStatus;
  price: number;
  quantity: number | null;
  room_quantity: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  hotel_checkout_date: string | null;
  transport_mode: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  created_at: string;
  packages: { title: string } | null;
}

// Extra line under the program/date cell for hotel room count and
// transport mode/day-count/pickup-dropoff. Same detail this data has
// carried since migration 024/028, but /api/partner/orders never
// selected any of it before, so partners never saw it.
function bookingDetailLine(b: Booking): string | null {
  if (b.service_type === 'hotel') {
    const parts: string[] = [];
    if (b.scheduled_date || b.hotel_checkout_date) {
      parts.push(`เข้าพัก ${b.scheduled_date || '-'} ถึง ${b.hotel_checkout_date || '-'}`);
    }
    if ((b.room_quantity ?? 1) > 1) parts.push(`${b.room_quantity} ห้อง`);
    return parts.length ? parts.join(' · ') : null;
  }
  if (b.service_type === 'transport') {
    const mode = b.transport_mode || 'one_way';
    const parts: string[] = [];
    if (mode === 'daily') {
      parts.push(`เหมารายวัน · ${b.quantity || 1} วัน`);
    } else if (mode === 'round_trip') {
      parts.push(`ไป-กลับ · ส่งกลับ ${b.transport_return_date || '-'} ${b.transport_return_time || ''}`.trim());
    } else {
      parts.push('เที่ยวเดียว');
    }
    if (b.pickup_location) parts.push(`รับ: ${b.pickup_location}`);
    if (b.dropoff_location) parts.push(`ส่ง: ${b.dropoff_location}`);
    return parts.join(' · ');
  }
  return null;
}

const STATUS_BADGE: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  checked_in: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-slate-100 text-slate-600',
};

const STATUS_OPTIONS: { value: BookingStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'pending', label: '⏳ รอดำเนินการ' },
  { value: 'confirmed', label: '✅ ยืนยันแล้ว' },
  { value: 'checked_in', label: '📍 เช็คอินแล้ว' },
  { value: 'completed', label: '🎉 เสร็จสิ้น' },
  { value: 'cancelled', label: '❌ ยกเลิก' },
  { value: 'refunded', label: '↩️ คืนเงินแล้ว' },
];

export function BookingsList({ partnerId }: { partnerId: string | null }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  async function loadBookings() {
    setLoading(true);
    setError(null);

    if (!partnerId) {
      // เหมือน DashboardMetrics.tsx: user ยังไม่ผูก branch_id -> โชว์
      // รายการว่างแทนการ error ทั้งหน้า
      setLoading(false);
      setBookings([]);
      return;
    }

    try {
      const res = await fetch('/api/partner/orders');
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || 'โหลดข้อมูลไม่สำเร็จ');
      }

      setBookings((json.orders as Booking[]) ?? []);
    } catch (err) {
      setError('โหลดข้อมูลไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  async function updateStatus(id: string, newStatus: BookingStatus) {
    setUpdatingId(id);

    try {
      const res = await fetch(`/api/partner/order-items/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || 'อัปเดตสถานะไม่สำเร็จ');
      }

      setBookings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status: newStatus } : b))
      );
    } catch (err) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUpdatingId(null);
    }
  }

  const filtered = useMemo(() => {
    let list = bookings;

    if (statusFilter !== 'all') {
      list = list.filter((b) => b.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (b) =>
          b.customer_name.toLowerCase().includes(q) ||
          b.customer_phone.includes(q) ||
          b.packages?.title?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [bookings, statusFilter, searchQuery]);

  const stats = useMemo(() => {
    const total = bookings.length;
    const pending = bookings.filter((b) => b.status === 'pending').length;
    const confirmed = bookings.filter((b) => b.status === 'confirmed').length;
    const completed = bookings.filter((b) => b.status === 'completed').length;
    return { total, pending, confirmed, completed };
  }, [bookings]);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-4">
          <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
          <p className="text-xs text-slate-500">ทั้งหมด</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-4">
          <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
          <p className="text-xs text-slate-500">รอดำเนินการ</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-4">
          <p className="text-2xl font-bold text-emerald-600">{stats.confirmed}</p>
          <p className="text-xs text-slate-500">ยืนยันแล้ว</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-4">
          <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
          <p className="text-xs text-slate-500">เสร็จสิ้น</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-primary text-white'
                  : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-[150px]">
          <input
            type="text"
            placeholder="🔍 ค้นหาชื่อ, เบอร์, โปรแกรม..."
            className="form-input text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <ExportBookings partnerId={partnerId} onExport={loadBookings} />
          <button
            onClick={loadBookings}
            className="text-sm text-primary-dark hover:underline whitespace-nowrap"
          >
            🔄 รีเฟรช
          </button>
        </div>
      </div>

      {/* Table */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
          📭 ไม่พบรายการจอง
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-500">ลูกค้า</th>
                <th className="px-4 py-3 font-semibold text-slate-500">โปรแกรม</th>
                <th className="px-4 py-3 font-semibold text-slate-500">วันที่</th>
                <th className="px-4 py-3 font-semibold text-slate-500">ราคา</th>
                <th className="px-4 py-3 font-semibold text-slate-500">สถานะ</th>
                <th className="px-4 py-3 font-semibold text-slate-500"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((booking) => (
                <tr key={booking.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">
                      {booking.customer_name}
                    </div>
                    <div className="text-xs text-slate-400">
                      {booking.customer_phone}
                      {booking.customer_line && ` · LINE: ${booking.customer_line}`}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {booking.packages?.title || '-'}
                    {bookingDetailLine(booking) ? (
                      <div className="text-xs text-slate-400">{bookingDetailLine(booking)}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {booking.scheduled_date || '-'}
                    {booking.scheduled_time && <span className="block text-xs text-slate-400">{booking.scheduled_time}</span>}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {booking.price ? formatTHB(booking.price) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={booking.status}
                      onChange={(e) => updateStatus(booking.id, e.target.value as BookingStatus)}
                      disabled={updatingId === booking.id}
                      className={`rounded-full px-2 py-1 text-xs font-medium border-0 ${STATUS_BADGE[booking.status]}`}
                    >
                      {STATUS_OPTIONS.filter((o) => o.value !== 'all').map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedOrderId(booking.order_id)}
                      className="text-xs text-primary-dark hover:underline"
                    >
                      รายละเอียด
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Booking Detail Modal */}
      {selectedOrderId && (
        <BookingDetailModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          onUpdate={loadBookings}
        />
      )}
    </div>
  );
}
