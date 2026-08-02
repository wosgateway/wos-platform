import { createClient } from '@/lib/supabase/server';

export interface Partner {
  id: string;
  name: string;
  category: string;
  status: 'active' | 'inactive';
  rating: number | null;
  review_count: number | null;
  cover_image_url: string | null;
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
  const supabase = createClient();
  let query = supabase.from('partners').select('*').eq('status', 'active');
  if (dbCategories && dbCategories.length > 0) {
    query = query.in('category', dbCategories);
  }
  const { data, error } = await query.order('rating', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchPartnerById(id: string): Promise<Partner> {
  const supabase = createClient();
  const { data, error } = await supabase.from('partners').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function fetchPackagesByPartner(
  partnerId: string,
  promotionsOnly?: boolean
): Promise<Package[]> {
  const supabase = createClient();
  // .eq('status', 'published') กันไม่ให้โปรแกรมที่ยังรออนุมัติ/ถูกปฏิเสธ
  // โผล่ไปหน้าเว็บสาธารณะที่ลูกค้าเห็น
  let query = supabase
    .from('packages')
    .select('*')
    .eq('partner_id', partnerId)
    .eq('status', 'published');
  if (promotionsOnly) query = query.eq('is_promotion', true);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchPackageById(id: string): Promise<Package> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('packages')
    .select('*, partners(*)')
    .eq('id', id)
    .eq('status', 'published')
    .single();
  if (error) throw error;
  return data;
}

export async function fetchPackagesByCategory(dbCategories: string[]): Promise<Package[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('packages')
    .select('*, partners!inner(id, name, category, status)')
    .in('partners.category', dbCategories)
    .eq('partners.status', 'active')
    .eq('status', 'published')
    .order('title', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
