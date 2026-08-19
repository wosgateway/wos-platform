// src/app/(partner-portal)/billing/page.tsx
import { requirePartnerAuth } from '@/lib/partner/auth';
import { BillingDashboard } from '@/components/partner/BillingDashboard';

export default async function BillingPage() {
  const { user } = await requirePartnerAuth();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">แผนและการเรียกเก็บเงิน</h1>
        <p className="text-sm text-slate-500">จัดการแพ็กเกจสมาชิกของ {user.organization.name}</p>
      </div>
      <BillingDashboard organizationId={user.organization_id} />
    </div>
  );
}