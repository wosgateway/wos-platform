// src/app/(partner-portal)/analytics/page.tsx
import { requirePartnerAuth } from '@/lib/partner/auth';
import { AnalyticsDashboard } from '@/components/partner/AnalyticsDashboard';

export default async function AnalyticsPage() {
  const { user } = await requirePartnerAuth();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">สรุปข้อมูล</h1>
        <p className="text-sm text-slate-500">
          ภาพรวมยอดจองและรายได้ของ {user.organization.name}
        </p>
      </div>
      <AnalyticsDashboard organizationId={user.organization_id} />
    </div>
  );
}
