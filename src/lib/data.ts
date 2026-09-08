import { createAnonClient } from '@/lib/supabase/server';

export interface Partner {
  id: string;
  name: string;
  category: string;
  status: 'active' | 'inactive';
  rating: number | null;
  review_count: number | null;
  cover_image_url: string | null;
  // Free-text, nullable — not every partner row has this filled in yet.
  // Known data quirk: "กรุงเทพฯ" vs "กรุงเทพ" are both in use for the
  // same province — normalize with src/lib/province.ts before using
  // this to build a filter dropdown or derive a distinct list.
  province: string | null;
  [key: string]: unknown;
}

export interface Package {
  id: string;
  partner_id: string;
  title: string;
  image_url: string | null;
  is_promotion: boolean;
  // ใหม่ — รองรับ workflow อนุมัติ (ดู migration_link_branches_packages.sql)
  // 'pending' = พาร์ทเนอร์ส่งมาจาก portal รอแอดมินอนุมัติ, 'published' = ขึ้นเว็บจริง,
  // 'rejected' = แอดมินปฏิเสธ, 'archived' = เคยเผยแพร่แล้วถอดออก
  status: 'pending' | 'published' | 'rejected' | 'archived';
  // สวิตช์เปิด/ปิดการแสดงผลของแอดมิน — แยกจาก status เพื่อให้แอดมินระงับ
  // การแสดงบนหน้าเว็บชั่วคราวได้โดยไม่ต้องรีเซ็ตสถานะอนุมัติ (ดู migration_add_package_is_active.sql)
  is_active: boolean;
  // Free-text, scoped per partners.category — see migration 082. For
  // Hotel packages this holds the room type (single/double/twin/deluxe/
  // suite/other) picked from a fixed dropdown in PackagesManager.tsx;
  // used to filter the hotel step in BookingForm.tsx/JourneyBookingForm.tsx.
  // NULL/unused for every other category.
  sub_category?: string | null;
  submitted_by: string | null;
  created_at: string;
  // ข้อมูลแนะนำที่พักตอนเบราส์ดูโปรแกรม — ไม่ใช่ราคาผูกมัด
  // ราคาจริงตอนจองคำนวณแยกเป็น order_item (service_type='hotel')
  suggested_hotel_name?: string | null;
  suggested_hotel_price_note?: string | null;
  partners?: Partner;
  [key: string]: unknown;
}

export async function fetchPartners(dbCategories?: string[]): Promise<Partner[]> {
  const supabase = createAnonClient();
  let query = supabase.from('partners').select('*').eq('status', 'active');
  if (dbCategories && dbCategories.length > 0) {
    query = query.in('category', dbCategories);
  }
  const { data, error } = await query.order('rating', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchPartnerById(id: string): Promise<Partner> {
  const supabase = createAnonClient();
  // .eq('status', 'active') — must match fetchPartners() below. Without
  // this, a deactivated/suspended partner is still fully viewable by
  // direct link (see migration 048: the DB-level RLS gap this also
  // depended on is fixed there, but this app-level filter stays as its
  // own explicit guard rather than relying on RLS alone).
  const { data, error } = await supabase
    .from('partners')
    .select('*')
    .eq('id', id)
    .eq('status', 'active')
    .single();
  if (error) throw error;
  return data;
}

export async function fetchPackagesByPartner(
  partnerId: string,
  promotionsOnly?: boolean
): Promise<Package[]> {
  const supabase = createAnonClient();
  // .eq('status', 'published') กันไม่ให้โปรแกรมที่ยังรออนุมัติ/ถูกปฏิเสธ
  // โผล่ไปหน้าเว็บสาธารณะที่ลูกค้าเห็น
  let query = supabase
    .from('packages')
    .select('*')
    .eq('partner_id', partnerId)
    .eq('status', 'published')
    .eq('is_active', true);
  if (promotionsOnly) query = query.eq('is_promotion', true);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchPackageById(id: string): Promise<Package> {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from('packages')
    .select('*, partners(*)')
    .eq('id', id)
    .eq('status', 'published')
    .eq('is_active', true)
    .single();
  if (error) throw error;
  return data;
}

// ใช้สำหรับสไลด์ "โปรแกรมแนะนำ" หน้า home — ดึงแพ็กเกจโปรโมชันจากพันธมิตรที่ active
// เรียงตามล่าสุดก่อน จำกัดจำนวนไม่ให้สไลด์ยาวเกินไป
export async function fetchFeaturedPackages(limit = 8): Promise<Package[]> {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from('packages')
    .select('*, partners!inner(id, name, category, status)')
    .eq('is_promotion', true)
    .eq('status', 'published')
    .eq('is_active', true)
    .eq('partners.status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ใช้สำหรับ trust bar หน้า home — จำนวนพันธมิตร active จริง แทนเลข hardcode
// head: true ให้ Postgres นับแบบ exact โดยไม่ต้องส่งข้อมูลแถวจริงกลับมา (เร็ว/เบากว่า select('*'))
export async function fetchActivePartnerCount(): Promise<number> {
  const supabase = createAnonClient();
  const { count, error } = await supabase
    .from('partners')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');
  if (error) throw error;
  return count ?? 0;
}

export async function fetchPackagesByCategory(dbCategories: string[]): Promise<Package[]> {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from('packages')
    // province included so the hotel-step province filter (BookingForm /
    // JourneyBookingForm) has something to filter on — see src/lib/province.ts
    .select('*, partners!inner(id, name, category, status, province)')
    .in('partners.category', dbCategories)
    .eq('partners.status', 'active')
    .eq('status', 'published')
    .eq('is_active', true)
    .order('title', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Starting-price hint for the transport booking step (migration 081) —
// replaces the old per-partner package dropdown, which didn't scale
// past a handful of transport partners and leaked partner names the
// cross-border customer had no way to evaluate anyway (see decision:
// vehicleType, chosen earlier in the flow, already acts as the
// price tier). Returns vehicle_type -> starting_price; a vehicle type
// with no row (or a 0 price) just means "no hint shown" in the UI.
export async function fetchTransportVehiclePricing(): Promise<Record<string, number>> {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from('transport_vehicle_pricing')
    .select('vehicle_type, starting_price')
    .eq('is_active', true);
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    map[row.vehicle_type as string] = Number(row.starting_price ?? 0);
  }
  return map;
}
