// src/components/partner/BookingDetailModal.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';

interface BookingDetail {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_line: string | null;
  customer_country: string | null;
  booking_date: string;
  booking_time: string | null;
  status: string;
  total_price: number | null;
  created_at: string;
  need_transport: boolean;
  need_hotel: boolean;
  transport_mode: string | null;
  transport_pickup_date: string | null;
  transport_pickup_time: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  transport_days: number | null;
  hotel_checkin_date: string | null;
  hotel_nights: number | null;
  attachment_url: string | null;
  notes: string | null;
  packages: {
    id: string;
    title: string;
    description: string | null;
    original_price: number;
    special_price: number | null;
    duration: string | null;
    partners: { name: string } | { name: string }[] | null;
  } | null;
  hotel_package: {
    id: string;
    title: string;
    original_price: number;
    special_price: number | null;
    partners: { name: string } | { name: string }[] | null;
  } | null;
  transport_package: {
    id: string;
    title: string;
    original_price: number;
    special_price: number | null;
    partners: { name: string } | { name: string }[] | null;
  } | null;
  patients: {
    full_name: string;
    phone: string;
    email: string | null;
    line_id: string | null;
    country: string | null;
  } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'รอดำเนินการ',
  confirmed: 'ยืนยันแล้ว',
  in_progress: 'กำลังดำเนินการ',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

function getOrgName(orgs: unknown): string | null {
  if (!orgs) return null;
  if (Array.isArray(orgs) && orgs.length > 0) {
    return (orgs[0] as { name: string })?.name || null;
  }
  return (orgs as { name: string })?.name || null;
}

interface BookingDetailModalProps {
  bookingId: string;
  onClose: () => void;
  onUpdate?: () => void;
}

export function BookingDetailModal({
  bookingId,
  onClose,
  onUpdate,
}: BookingDetailModalProps) {
  const supabase = createClient();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  async function loadBooking() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('partner_bookings')
      .select(`
        *,
        packages!bookings_package_id_fkey (
          id,
          title,
          description,
          original_price,
          special_price,
          duration,
          partners ( name )
        ),
        hotel_package:hotel_package_id (
          id,
          title,
          original_price,
          special_price,
          partners ( name )
        ),
        transport_package:transport_package_id (
          id,
          title,
          original_price,
          special_price,
          partners ( name )
        ),
        patients (
          full_name,
          phone,
          email,
          line_id,
          country
        )
      `)
      .eq('id', bookingId)
      .single();

    setLoading(false);

    if (fetchError) {
      setError('โหลดข้อมูลไม่สำเร็จ: ' + fetchError.message);
      return;
    }

    setBooking(data as unknown as BookingDetail);
  }

  useEffect(() => {
    loadBooking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  async function updateStatus(newStatus: string) {
    if (!confirm('เปลี่ยนสถานะเป็น ' + (STATUS_LABEL[newStatus] || newStatus) + '?')) return;

    setUpdating(true);
    const { error: updateError } = await supabase
      .from('partner_bookings')
      .update({ status: newStatus })
      .eq('id', bookingId);

    setUpdating(false);

    if (updateError) {
      alert('อัปเดตไม่สำเร็จ: ' + updateError.message);
      return;
    }

    await loadBooking();
    if (onUpdate) onUpdate();
  }

  async function updateNotes(notes: string) {
    const { error: updateError } = await supabase
      .from('partner_bookings')
      .update({ notes })
      .eq('id', bookingId);

    if (updateError) {
      alert('บันทึกไม่สำเร็จ: ' + updateError.message);
      return;
    }

    await loadBooking();
  }

  function getPrice(booking: BookingDetail) {
    const main = booking.packages
      ? Number(booking.packages.special_price || booking.packages.original_price || 0)
      : 0;

    const hotel = booking.need_hotel && booking.hotel_package
      ? Number(booking.hotel_package.special_price || booking.hotel_package.original_price || 0) *
        (booking.hotel_nights || 1)
      : 0;

    const transport = booking.need_transport && booking.transport_package
      ? Number(booking.transport_package.special_price || booking.transport_package.original_price || 0) *
        (booking.transport_mode === 'daily' ? (booking.transport_days || 1) : 1)
      : 0;

    return { main, hotel, transport, total: main + hotel + transport };
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-2xl p-8 max-w-2xl w-full">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-2xl p-8 max-w-2xl w-full">
          <div className="text-center text-red-600">
            <p>{error || 'ไม่พบข้อมูล'}</p>
            <button onClick={onClose} className="mt-4 btn-primary text-sm">
              ปิด
            </button>
          </div>
        </div>
      </div>
    );
  }

  const price = getPrice(booking);
  const statusOptions = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-bold text-slate-900">รายละเอียดการจอง</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl"
          >
            &times;
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-4">
            <span className={'px-3 py-1 rounded-full text-sm font-medium ' + STATUS_BADGE[booking.status]}>
              {STATUS_LABEL[booking.status] || booking.status}
            </span>
            <select
              value={booking.status}
              onChange={(e) => updateStatus(e.target.value)}
              disabled={updating}
              className="form-input text-sm py-1.5 w-auto"
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s] || s}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl">
            <div>
              <p className="text-xs text-slate-400">ชื่อลูกค้า</p>
              <p className="font-medium text-slate-800">{booking.customer_name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">เบอร์โทร</p>
              <p className="font-medium text-slate-800">{booking.customer_phone}</p>
            </div>
            {booking.customer_line && (
              <div>
                <p className="text-xs text-slate-400">LINE ID</p>
                <p className="font-medium text-slate-800">{booking.customer_line}</p>
              </div>
            )}
            {booking.customer_country && (
              <div>
                <p className="text-xs text-slate-400">ประเทศ</p>
                <p className="font-medium text-slate-800">{booking.customer_country}</p>
              </div>
            )}
          </div>

          <div className="p-4 bg-primary-light/30 rounded-xl">
            <p className="text-xs text-slate-400">วัน/เวลานัดหมาย</p>
            <p className="font-medium text-slate-800">
              {booking.booking_date || '-'}
              {booking.booking_time ? ' - ' + booking.booking_time : ''}
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-900 mb-2">โปรแกรมหลัก</h4>
            {booking.packages ? (
              <div className="p-4 border border-slate-100 rounded-xl">
                <p className="font-medium text-slate-800">{booking.packages.title}</p>
                <p className="text-xs text-slate-400">{getOrgName(booking.packages.partners) || '-'}</p>
                {booking.packages.description && (
                  <p className="text-sm text-slate-600 mt-1">{booking.packages.description}</p>
                )}
                <p className="text-sm font-medium text-primary mt-2">
                  {formatTHB(price.main)}
                  {booking.packages.duration ? ' - ' + booking.packages.duration : ''}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-400">-</p>
            )}
          </div>

          {(booking.need_hotel || booking.need_transport) && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-slate-900">บริการเสริม</h4>

              {booking.need_hotel && booking.hotel_package && (
                <div className="p-4 border border-slate-100 rounded-xl">
                  <p className="font-medium text-slate-800">{booking.hotel_package.title}</p>
                  <p className="text-xs text-slate-400">{getOrgName(booking.hotel_package.partners) || '-'}</p>
                  <p className="text-sm text-slate-600">
                    เช็คอิน: {booking.hotel_checkin_date || '-'} - {booking.hotel_nights || 1} คืน
                  </p>
                  <p className="text-sm font-medium text-primary">
                    {formatTHB(price.hotel)}
                  </p>
                </div>
              )}

              {booking.need_transport && booking.transport_package && (
                <div className="p-4 border border-slate-100 rounded-xl">
                  <p className="font-medium text-slate-800">{booking.transport_package.title}</p>
                  <p className="text-xs text-slate-400">{getOrgName(booking.transport_package.partners) || '-'}</p>
                  <p className="text-sm text-slate-600">
                    {booking.transport_mode === 'one_way' && 'เที่ยวเดียว'}
                    {booking.transport_mode === 'round_trip' && 'ไป-กลับ'}
                    {booking.transport_mode === 'daily' && ('เหมาจ่ายวัน ' + (booking.transport_days || 1) + ' วัน')}
                    {booking.transport_pickup_date ? ' - รับ ' + booking.transport_pickup_date : ''}
                    {booking.transport_pickup_time ? ' ' + booking.transport_pickup_time : ''}
                    {booking.transport_return_date ? ' - ส่งกลับ ' + booking.transport_return_date : ''}
                  </p>
                  <p className="text-sm font-medium text-primary">
                    {formatTHB(price.transport)}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="p-4 bg-primary-light/20 rounded-xl border border-primary/20">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">โปรแกรมหลัก</span>
              <span>{formatTHB(price.main)}</span>
            </div>
            {booking.need_hotel && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">โรงแรม</span>
                <span>{formatTHB(price.hotel)}</span>
              </div>
            )}
            {booking.need_transport && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">รถรับส่ง</span>
                <span>{formatTHB(price.transport)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-slate-900 border-t border-primary/20 pt-2 mt-2">
              <span>รวมทั้งหมด</span>
              <span>{formatTHB(price.total)}</span>
            </div>
          </div>

          {booking.attachment_url && (
            <div>
              <p className="text-xs text-slate-400 mb-1">ไฟล์แนบ</p>
              
                <a
href={booking.attachment_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline text-sm"
              >
                เปิดไฟล์แนบ
              </a>
            </div>
          )}

          <div>
            <label className="form-label">หมายเหตุ</label>
            <textarea
              className="form-input"
              rows={3}
              defaultValue={booking.notes || ''}
              onBlur={(e) => updateNotes(e.target.value)}
              placeholder="เพิ่มหมายเหตุเกี่ยวกับการจองนี้..."
            />
            <p className="mt-1 text-xs text-slate-400">บันทึกอัตโนมัติเมื่อเปลี่ยนโฟกัส</p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              ปิด
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}