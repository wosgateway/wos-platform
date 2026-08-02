// src/app/(partner-portal)/documents/page.tsx
import { requirePartnerAuth } from '@/lib/partner/auth';
import { DocumentsManager } from '@/components/partner/DocumentsManager';

export default async function DocumentsPage() {
  const { user } = await requirePartnerAuth();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">เอกสาร</h1>
        <p className="text-sm text-slate-500">ใบอนุญาตและเอกสารสำคัญของ {user.organization.name}</p>
      </div>
      <DocumentsManager organizationId={user.organization_id} userId={user.id} />
    </div>
  );
}
