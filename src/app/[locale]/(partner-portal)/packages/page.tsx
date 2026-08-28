// src/app/(partner-portal)/packages/page.tsx
import { requirePartnerAuth } from '@/lib/partner/auth';
import { PackagesManager } from '@/components/partner/PackagesManager';

export default async function PackagesPage() {
  const { user } = await requirePartnerAuth();

  // สาขานี้ยังไม่ถูกผูกกับ partner listing บนเว็บสาธารณะ (แอดมินยังไม่ได้
  // เชื่อมให้ผ่าน branches.partner_id) — สร้างโปรแกรมไปก็ไม่มี partner_id
  // ให้ผูก จึงกันไว้ตรงนี้แทนที่จะปล่อยให้ insert ล้มเหลวแบบงงๆ
  if (!user.branch?.partner_id) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">โปรแกรม/แพ็กเกจ</h1>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          ⚠️ บัญชีของคุณยังไม่ถูกเชื่อมกับรายชื่อพาร์ทเนอร์บนเว็บไซต์
          กรุณาติดต่อทีมงาน WOS เพื่อดำเนินการเชื่อมสาขาของคุณก่อนเริ่มสร้างโปรแกรม
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">โปรแกรม/แพ็กเกจ</h1>
        <p className="text-sm text-slate-500">
          จัดการโปรแกรมที่เปิดให้จองของ {user.branch.name} ({user.organization.name})
        </p>
        <p className="mt-1 text-xs text-slate-400">
          📌 โปรแกรมที่สร้างใหม่จะขึ้นสถานะ &quot;รอตรวจสอบ&quot; จนกว่าทีมงาน WOS จะอนุมัติ
          ถึงจะแสดงบนเว็บไซต์จริง
        </p>
      </div>
      <PackagesManager partnerId={user.branch.partner_id} organizationId={user.organization_id} />
    </div>
  );
}
