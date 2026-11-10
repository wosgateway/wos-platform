// src/app/[locale]/(partner-portal)/vehicles/page.tsx
//
// Phase 4 ของ Milestone 2 (Transport Group) — หน้าจัดการ fleet รถ
// (migration 119: public.vehicles) โครง auth/category-fetch เดียวกับ
// packages/page.tsx และ availability/page.tsx เป๊ะๆ — ดูคอมเมนต์ที่นั่น
// สำหรับเหตุผลเต็มของ branch.partner_id
//
// Transport-only ในเฟสนี้ (vehicles มี trigger กันไว้ระดับ DB ด้วย —
// ดู check_vehicles_transport_only ใน migration 119) พาร์ทเนอร์หมวดอื่น
// เห็นหน้านี้ได้ (nav item ยังไม่ได้ซ่อนตาม category — ดูคอมเมนต์ใน
// PartnerSidebar.tsx เหมือนกับ "ห้องว่าง") แต่จะเจอข้อความอธิบายแทน
import { requirePartnerAuth } from '@/lib/partner/auth';
import { createClient } from '@/lib/supabase/server';
import { VehiclesManager } from '@/components/partner/VehiclesManager';

export default async function VehiclesPage() {
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
          <h1 className="text-2xl font-bold text-slate-900">รถ / Vehicles</h1>
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
          <h1 className="text-2xl font-bold text-slate-900">รถ / Vehicles</h1>
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
        <h1 className="text-2xl font-bold text-slate-900">รถ / Vehicles</h1>
        <p className="text-sm text-slate-500">
          จัดการข้อมูลรถของ {user.branch.name} ({user.organization.name})
        </p>
        <p className="mt-1 text-xs text-slate-400">
          📌 ยังไม่ผูกกับระบบจ่ายงาน/มอบหมายคนขับอัตโนมัติ — ทีมงาน WOS ยังคงเป็นผู้จัดคิวงานให้ในทุกออเดอร์
        </p>
      </div>
      <VehiclesManager partnerId={user.branch.partner_id} />
    </div>
  );
}
