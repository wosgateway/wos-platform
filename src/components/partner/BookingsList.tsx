// src/components/partner/BookingsList.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';
import { BookingDetailModal } from './BookingDetailModal';
import { ExportBookings } from './ExportBookings';

type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

interface Booking {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_line: string | null;
  booking_date: string;
  booking_time: string | null;
  status: BookingStatus;
  total_price: number | null;
  created_at: string;
  packages: { title: string } | null;
  patients: { full_name: string; phone: string } | null;
}

const STATUS_BADGE: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};


const STATUS_OPTIONS: { value: BookingStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'pending', label: '⏳ รอดำเนินการ' },
  { value: 'confirmed', label: '✅ ยืนยันแล้ว' },
  { value: 'in_progress', label: '🔄 กำลังดำเนินการ' },
  { value: 'completed', label: '🎉 เสร็จสิ้น' },
  { value: 'cancelled', label: '❌ ยกเลิก' },
];

export function BookingsList({ organizationId }: { organizationId: string }) {
  const supabase = createClient();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);

  async function loadBookings() {
    setLoading(true);
    setError(null);

    const query = supabase
      .from('partner_bookings')
      .select(`
        id,
        customer_name,
        customer_phone,
        customer_line,
        booking_date,
        booking_time,
        status,
        total_price,
        created_at,
        packages!bookings_package_id_fkey ( title ),
        patients ( full_name, phone )
      `)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    const { data, error: fetchError } = await query;

    setLoading(false);

    if (fetchError) {
      setError('โหลดข้อมูลไม่สำเร็จ: ' + fetchError.message);
      return;
    }

    setBookings(data as unknown as Booking[]);
  }

  useEffect(() => {
    loadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateStatus(id: string, newStatus: BookingStatus) {
    setUpdatingId(id);
    const { error: updateError } = await supabase
      .from('partner_bookings')
      .update({ status: newStatus })
      .eq('id', id);

    setUpdatingId(null);

    if (updateError) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + updateError.message);
      return;
    }

    setBookings((prev) =>
      prev.map((b) => (b.id === id ? { ...b, status: newStatus } : b))
    );
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
          <ExportBookings organizationId={organizationId} onExport={loadBookings} />
          <button
            onClick={loadBookings}
            className="text-sm text-primary hover:underline whitespace-nowrap"
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
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {booking.booking_date || '-'}
                    {booking.booking_time && <span className="block text-xs text-slate-400">{booking.booking_time}</span>}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {booking.total_price ? formatTHB(booking.total_price) : '-'}
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
                      onClick={() => setSelectedBookingId(booking.id)}
                      className="text-xs text-primary hover:underline"
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
      {selectedBookingId && (
        <BookingDetailModal
          bookingId={selectedBookingId}
          onClose={() => setSelectedBookingId(null)}
          onUpdate={loadBookings}
        />
      )}
    </div>
  );
}
