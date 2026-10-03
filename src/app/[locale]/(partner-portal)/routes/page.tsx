// src/app/[locale]/(partner-portal)/routes/page.tsx
//
// Phase 5 ของ Milestone 2 (Transport Group) — หน้าจัดการเส้นทางให้บริการ
// (migration 121: public.transport_routes + public.transport_locations)
// โครง auth/category-fetch เดียวกับ vehicles/page.tsx และ availability/page.tsx
//
// Transport-only ในเฟสนี้ (transport_routes มี trigger กันไว้ระดับ DB ด้วย —
// ดู check_transport_routes_transport_only ใน migration 121)
import { requirePartnerAuth } from '@/lib/partner/auth';
import { createClient } from '@/lib/supabase/server';
import { RoutesManager } from '@/components/partner/RoutesManager';

export default async function RoutesPage() {
  const { user } = await requirePartnerAuth();

  let partnerCategory: string | null = null;
  if (user.branch?.partner_id) {
    const supabase = createClient();
    const { data: partnerRow } = await supabase
      .from('partners')
      .select('category')
      .eq('id', user.branch.partner_id)
      .single();
    partnerCategory = partnerRow?.category ?? null;
  }

  if (!user.branch?.partner_id) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">เส้นทาง / Routes</h1>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          ⚠️ บัญชีของคุณยังไม่ถูกเชื่อมกับรายชื่อพาร์ทเนอร์บนเว็บไซต์
          กรุณาติดต่อทีมงาน WOS เพื่อดำเนินการเชื่อมสาขาของคุณก่อน
        </div>
      </div>
    );
  }

  if (partnerCategory !== 'Transport') {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">เส้นทาง / Routes</h1>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
          เมนูนี้สำหรับพาร์ทเนอร์ประเภทขนส่งในระยะนำร่องนี้ก่อน
          หากบัญชีของคุณควรเป็นหมวดขนส่ง กรุณาติดต่อทีมงาน WOS
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">เส้นทาง / Routes</h1>
        <p className="text-sm text-slate-500">
          จัดการเส้นทางที่ให้บริการของ {user.branch.name} ({user.organization.name})
        </p>
        <p className="mt-1 text-xs text-slate-400">
          📌 เส้นทางเป็นข้อมูลตั้งต้นสำหรับการให้บริการขนส่ง ยังไม่รวมราคาและการจัดรถ —
          ทีมงาน WOS ยังคงเป็นผู้จัดคิวงานให้ในทุกออเดอร์
        </p>
      </div>
      <RoutesManager partnerId={user.branch.partner_id} />
    </div>
  );
}
