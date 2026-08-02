// src/app/(partner-portal)/dashboard/page.tsx
import { requirePartnerAuth } from '@/lib/partner/auth';
import { DashboardMetrics } from '@/components/partner/DashboardMetrics';
import { RecentBookings } from '@/components/partner/RecentBookings';

export default async function DashboardPage() {
  const { user } = await requirePartnerAuth();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">ภาพรวม</h1>
        <p className="text-sm text-slate-500">ยินดีต้อนรับกลับ, {user.full_name} 👋</p>
      </div>
      <DashboardMetrics organizationId={user.organization_id} partnerId={user.branch?.partner_id ?? null} />
      <div className="mt-8">
        <RecentBookings organizationId={user.organization_id} />
      </div>
    </div>
  );
}