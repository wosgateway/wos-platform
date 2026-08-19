// src/app/(partner-portal)/dashboard/page.tsx
import { requirePartnerAuth } from '@/lib/partner/auth';
import { DashboardMetrics } from '@/components/partner/DashboardMetrics';
import { RecentBookings } from '@/components/partner/RecentBookings';

export default async function DashboardPage() {
  const { user } = await requirePartnerAuth();
  const partnerId = user.branch?.partner_id ?? null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">ภาพรวม</h1>
        <p className="text-sm text-slate-500">ยินดีต้อนรับกลับ, {user.full_name} 👋</p>
      </div>
      <DashboardMetrics partnerId={partnerId} />
      <div className="mt-8">
        <RecentBookings partnerId={partnerId} />
      </div>
    </div>
  );
}