// src/components/partner/DashboardMetrics.tsx
import { createClient } from '@/lib/supabase/server';

async function getMetrics(organizationId: string, partnerId: string | null) {
  const supabase = createClient();

  const [
    { count: totalBookings },
    { count: pendingBookings },
    { count: confirmedBookings },
    { count: completedBookings },
    { count: totalPackages },
    { count: publishedPackages },
  ] = await Promise.all([
    supabase.from('partner_bookings').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    supabase.from('partner_bookings').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'pending'),
    supabase.from('partner_bookings').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'confirmed'),
    supabase.from('partner_bookings').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'completed'),
    partnerId
      ? supabase.from('packages').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId)
      : Promise.resolve({ count: 0 }),
    partnerId
      ? supabase.from('packages').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('status', 'published')
      : Promise.resolve({ count: 0 }),
  ]);

  return {
    totalBookings: totalBookings || 0,
    pendingBookings: pendingBookings || 0,
    confirmedBookings: confirmedBookings || 0,
    completedBookings: completedBookings || 0,
    totalPackages: totalPackages || 0,
    publishedPackages: publishedPackages || 0,
  };
}

const METRIC_CARDS = [
  { key: 'totalBookings', label: 'การจองทั้งหมด', icon: '📋', color: 'blue' },
  { key: 'pendingBookings', label: 'รอดำเนินการ', icon: '⏳', color: 'amber' },
  { key: 'confirmedBookings', label: 'ยืนยันแล้ว', icon: '✅', color: 'emerald' },
  { key: 'completedBookings', label: 'เสร็จสิ้น', icon: '🎉', color: 'green' },
  { key: 'totalPackages', label: 'โปรแกรมทั้งหมด', icon: '📦', color: 'purple' },
  { key: 'publishedPackages', label: 'โปรแกรมที่เผยแพร่', icon: '🚀', color: 'indigo' },
];

export async function DashboardMetrics({
  organizationId,
  partnerId,
}: {
  organizationId: string;
  partnerId: string | null;
}) {
  const metrics = await getMetrics(organizationId, partnerId);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {METRIC_CARDS.map((card) => (
        <div key={card.key} className="bg-white rounded-xl border border-slate-100 shadow-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-2xl">{card.icon}</span>
            <span className="text-2xl font-bold text-slate-900">
              {metrics[card.key as keyof typeof metrics] ?? 0}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{card.label}</p>
        </div>
      ))}
    </div>
  );
}