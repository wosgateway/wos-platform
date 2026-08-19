// src/app/(partner-portal)/company/page.tsx
import { requirePartnerAuth } from '@/lib/partner/auth';
import { CompanyProfile } from '@/components/partner/CompanyProfile';

export default async function CompanyPage() {
  const { user } = await requirePartnerAuth();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">ข้อมูลบริษัท</h1>
        <p className="text-sm text-slate-500">แก้ไขโปรไฟล์และข้อมูลติดต่อของ {user.organization.name}</p>
      </div>
      <CompanyProfile
  organizationId={user.organization_id}
/>
    </div>
  );
}