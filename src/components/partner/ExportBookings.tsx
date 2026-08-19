// src/components/partner/ExportBookings.tsx
'use client';

import { useState } from 'react';

interface ExportBookingsProps {
  partnerId: string | null;
  onExport?: () => void;
}

interface PartnerOrderRow {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_line: string | null;
  customer_country: string | null;
  service_type: string;
  status: string;
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

export function ExportBookings({ partnerId, onExport }: ExportBookingsProps) {
  const [exporting, setExporting] = useState(false);

  async function exportCSV() {
    if (!partnerId) {
      alert('บัญชีนี้ยังไม่ได้ผูกกับ partner');
      return;
    }

    setExporting(true);

    let data: PartnerOrderRow[] = [];
    try {
      const res = await fetch('/api/partner/orders');
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || 'ส่งออกไม่สำเร็จ');
      }

      data = (json.orders as PartnerOrderRow[]) ?? [];
    } catch (err) {
      setExporting(false);
      alert('ส่งออกไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }

    setExporting(false);

    if (data.length === 0) {
      alert('ไม่มีข้อมูลที่จะส่งออก');
      return;
    }

    const headers = [
      'เลขที่ออเดอร์',
      'ชื่อลูกค้า',
      'เบอร์โทร',
      'LINE ID',
      'ประเทศ',
      'ประเภทบริการ',
      'วันที่ใช้บริการ',
      'เวลา',
      'เช็คเอาท์ (โรงแรม)',
      'จำนวนห้อง',
      'โหมดรถ',
      'จำนวนวัน (เหมา)',
      'รับที่',
      'ส่งที่',
      'โปรแกรม',
      'สถานะ',
      'ราคา',
      'วันที่แจ้ง',
    ];

    const rows = data.map((b) => [
      b.order_number,
      b.customer_name,
      b.customer_phone,
      b.customer_line || '',
      b.customer_country || '',
      b.service_type,
      b.scheduled_date || '',
      b.scheduled_time || '',
      b.hotel_checkout_date || '',
      b.service_type === 'hotel' ? b.room_quantity ?? 1 : '',
      b.service_type === 'transport' ? b.transport_mode || '' : '',
      b.service_type === 'transport' && b.transport_mode === 'daily' ? b.quantity ?? 1 : '',
      b.pickup_location || '',
      b.dropoff_location || '',
      b.packages?.title || '',
      b.status,
      b.price || 0,
      new Date(b.created_at).toLocaleString('th-TH'),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bookings_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    if (onExport) onExport();
  }

  return (
    <button
      onClick={exportCSV}
      disabled={exporting}
      className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
    >
      {exporting ? 'กำลังส่งออก' : 'ส่งออก'} CSV
    </button>
  );
}