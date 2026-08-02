// src/components/partner/AnalyticsDashboard.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';

type Period = '7d' | '30d' | '90d' | 'all';

interface BookingRow {
  status: string;
  total_price: number | null;
  booking_date: string;
  created_at: string;
  packages: { title: string } | null;
}

interface AnalyticsData {
  totalBookings: number;
  pendingBookings: number;
  confirmedBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  totalRevenue: number;
  topPackages: { title: string; count: number }[];
  monthlyBreakdown: { month: string; count: number; revenue: number }[];
}

const PERIOD_DAYS: Record<Exclude<Period, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function periodStartDate(period: Period): string | null {
  if (period === 'all') return null;
  const days = PERIOD_DAYS[period];
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function computeAnalytics(rows: BookingRow[]): AnalyticsData {
  const totalBookings = rows.length;
  const pendingBookings = rows.filter((r) => r.status === 'pending').length;
  const confirmedBookings = rows.filter((r) => r.status === 'confirmed').length;
  const completedBookings = rows.filter((r) => r.status === 'completed').length;
  const cancelledBookings = rows.filter((r) => r.status === 'cancelled').length;

  const totalRevenue = rows
    .filter((r) => r.status !== 'cancelled')
    .reduce((sum, r) => sum + (r.total_price || 0), 0);

  const packageCounts = new Map<string, number>();
  for (const r of rows) {
    const title = r.packages?.title || 'ไม่ระบุโปรแกรม';
    packageCounts.set(title, (packageCounts.get(title) || 0) + 1);
  }
  const topPackages = Array.from(packageCounts.entries())
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const monthMap = new Map<string, { count: number; revenue: number }>();
  for (const r of rows) {
    const month = r.booking_date?.slice(0, 7) || r.created_at.slice(0, 7);
    const entry = monthMap.get(month) || { count: 0, revenue: 0 };
    entry.count += 1;
    if (r.status !== 'cancelled') entry.revenue += r.total_price || 0;
    monthMap.set(month, entry);
  }
  const monthlyBreakdown = Array.from(monthMap.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    totalBookings,
    pendingBookings,
    confirmedBookings,
    completedBookings,
    cancelledBookings,
    totalRevenue,
    topPackages,
    monthlyBreakdown,
  };
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return new Intl.DateTimeFormat('th-TH', { month: 'short', year: '2-digit' }).format(date);
}

export function AnalyticsDashboard({ organizationId }: { organizationId: string }) {
  const supabase = createClient();
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('partner_bookings')
        .select('status, total_price, booking_date, created_at, packages!bookings_package_id_fkey ( title )')
        .eq('organization_id', organizationId);

      const startDate = periodStartDate(period);
      if (startDate) {
        query = query.gte('booking_date', startDate);
      }

      const { data: rows, error: fetchError } = await query;

      if (cancelled) return;
      setLoading(false);

      if (fetchError) {
        setError('โหลดข้อมูลไม่สำเร็จ: ' + fetchError.message);
        return;
      }

      setData(computeAnalytics((rows as unknown as BookingRow[]) ?? []));
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [organizationId, period]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-600">
        {error || 'ไม่พบข้อมูล'}
      </div>
    );
  }

  const {
    totalBookings,
    pendingBookings,
    confirmedBookings,
    completedBookings,
    cancelledBookings,
    totalRevenue,
    topPackages,
    monthlyBreakdown,
  } = data;

  const maxMonthlyCount = Math.max(1, ...monthlyBreakdown.map((m) => m.count));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {(['7d', '30d', '90d', 'all'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              period === p
                ? 'bg-primary text-white'
                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {p === '7d' && '7 วัน'}
            {p === '30d' && '30 วัน'}
            {p === '90d' && '90 วัน'}
            {p === 'all' && 'ทั้งหมด'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-4">
          <p className="text-2xl font-bold text-slate-900">{totalBookings}</p>
          <p className="text-xs text-slate-500">การจองทั้งหมด</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-4">
          <p className="text-2xl font-bold text-amber-600">{pendingBookings}</p>
          <p className="text-xs text-slate-500">รอดำเนินการ</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-4">
          <p className="text-2xl font-bold text-emerald-600">{confirmedBookings}</p>
          <p className="text-xs text-slate-500">ยืนยันแล้ว</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-4">
          <p className="text-2xl font-bold text-green-600">{completedBookings}</p>
          <p className="text-xs text-slate-500">เสร็จสิ้น</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-4">
          <p className="text-2xl font-bold text-primary">{formatTHB(totalRevenue)}</p>
          <p className="text-xs text-slate-500">รายได้ทั้งหมด (ไม่รวมรายการที่ยกเลิก)</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-4">
          <p className="text-2xl font-bold text-red-500">{cancelledBookings}</p>
          <p className="text-xs text-slate-500">ยกเลิก</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-card p-5">
        <h3 className="mb-4 font-semibold text-slate-900">แนวโน้มรายเดือน</h3>
        {monthlyBreakdown.length === 0 ? (
          <p className="text-sm text-slate-400">ไม่มีข้อมูลในช่วงเวลานี้</p>
        ) : (
          <div className="flex items-end gap-3 overflow-x-auto pb-2">
            {monthlyBreakdown.map((m) => (
              <div key={m.month} className="flex flex-col items-center gap-1 min-w-[48px]">
                <div className="flex h-32 items-end">
                  <div
                    className="w-8 rounded-t-md bg-primary/80"
                    style={{ height: `${Math.max(4, (m.count / maxMonthlyCount) * 100)}%` }}
                    title={`${m.count} รายการ · ${formatTHB(m.revenue)}`}
                  />
                </div>
                <span className="text-xs font-medium text-slate-700">{m.count}</span>
                <span className="text-[10px] text-slate-400">{formatMonthLabel(m.month)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-card p-5">
        <h3 className="mb-4 font-semibold text-slate-900">โปรแกรมยอดนิยม</h3>
        {topPackages.length === 0 ? (
          <p className="text-sm text-slate-400">ไม่มีข้อมูลในช่วงเวลานี้</p>
        ) : (
          <ul className="space-y-3">
            {topPackages.map((pkg, i) => (
              <li key={pkg.title} className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-400 w-4">{i + 1}</span>
                <span className="flex-1 truncate text-sm text-slate-700">{pkg.title}</span>
                <span className="text-sm font-semibold text-slate-900">{pkg.count} รายการ</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}