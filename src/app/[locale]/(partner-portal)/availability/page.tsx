// src/app/[locale]/(partner-portal)/availability/page.tsx
//
// Phase 2 ของ Hotel Pilot brief — หน้าปฏิทินห้องว่าง (migration 117:
// room_availability). โครง auth/category-fetch เดียวกับ packages/page.tsx
// เป๊ะๆ — ดูคอมเมนต์ที่นั่นสำหรับเหตุผลเต็มของ branch.partner_id
//
// Hotel-only ในเฟสนี้ (room_availability มี trigger กันไว้ระดับ DB ด้วย
// — ดู check_room_availability_hotel_only ใน migration 117) พาร์ทเนอร์
// หมวดอื่นเห็นหน้านี้ได้ (nav item ยังไม่ได้ซ่อนตาม category — ดูคอมเมนต์ใน
// PartnerSidebar.tsx) แต่จะเจอข้อความอธิบายแทนปฏิทินเปล่าที่ error
import { requirePartnerAuth } from '@/lib/partner/auth';
import { createClient } from '@/lib/supabase/server';
import { RoomAvailabilityManager } from '@/components/partner/RoomAvailabilityManager';

export default async function AvailabilityPage() {
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
          <h1 className="text-2xl font-bold text-slate-900">ห้องว่าง / Availability</h1>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          ⚠️ บัญชีของคุณยังไม่ถูกเชื่อมกับรายชื่อพาร์ทเนอร์บนเว็บไซต์
          กรุณาติดต่อทีมงาน WOS เพื่อดำเนินการเชื่อมสาขาของคุณก่อน
        </div>
      </div>
    );
  }

  if (partnerCategory !== 'Hotel') {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">ห้องว่าง / Availability</h1>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
          เมนูนี้สำหรับพาร์ทเนอร์ประเภทโรงแรมในระยะนำร่องนี้ก่อน
          หากบัญชีของคุณควรเป็นหมวดโรงแรม กรุณาติดต่อทีมงาน WOS
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">ห้องว่าง / Availability</h1>
        <p className="text-sm text-slate-500">
          ตั้งค่าจำนวนห้องว่างและราคาต่อวันของ {user.branch.name} ({user.organization.name})
        </p>
        <p className="mt-1 text-xs text-slate-400">
          📌 ปฏิทินนี้ยังเป็นข้อมูลอ้างอิง/วางแผนภายใน — ยังไม่ผูกกับระบบจองอัตโนมัติ
          ทีมงาน WOS ยังคงเป็นผู้ยืนยันจำนวนห้องกับลูกค้าในทุกออเดอร์
        </p>
      </div>
      <RoomAvailabilityManager partnerId={user.branch.partner_id} />
    </div>
  );
}
