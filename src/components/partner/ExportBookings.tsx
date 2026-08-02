// src/components/partner/ExportBookings.tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface ExportBookingsProps {
  organizationId: string;
  onExport?: () => void;
}

export function ExportBookings({ organizationId, onExport }: ExportBookingsProps) {
  const supabase = createClient();
  const [exporting, setExporting] = useState(false);

  async function exportCSV() {
    setExporting(true);

    const { data, error } = await supabase
      .from('partner_bookings')
      .select(`
        id,
        customer_name,
        customer_phone,
        customer_line,
        customer_country,
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

    setExporting(false);

    if (error) {
      alert('ส่งออกไม่สำเร็จ: ' + error.message);
      return;
    }

    if (!data || data.length === 0) {
      alert('ไม่มีข้อมูลที่จะส่งออก');
      return;
    }

    const headers = [
      'รหัสการจอง',
      'ชื่อลูกค้า',
      'เบอร์โทร',
      'LINE ID',
      'ประเทศ',
      'วันที่ใช้บริการ',
      'เวลา',
      'โปรแกรม',
      'สถานะ',
      'ราคารวม',
      'วันที่แจ้ง',
    ];

    const rows = data.map((b: any) => [
      b.id,
      b.customer_name,
      b.customer_phone,
      b.customer_line || '',
      b.customer_country || '',
      b.booking_date || '',
      b.booking_time || '',
      b.packages?.title || '',
      b.status,
      b.total_price || 0,
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