import { createClient } from '@/lib/supabase/server';

// Ported 1:1 from the data-layer functions in the old js/main.js
// (window.fetchPartners, fetchPartnerById, fetchPackagesByPartner,
// fetchPackageById, fetchPackagesByCategory). Behavior is unchanged —
// same tables, same filters, same ordering — just typed and run
// server-side so pages can fetch during render (SSR) instead of a
// client-side spinner-then-fetch on every page.

export interface Partner {
  id: string;
  name: string;
  category: string;
  status: 'active' | 'inactive';
  rating: number | null;
  cover_image_url: string | null;
  [key: string]: unknown;
}

export interface Package {
  id: string;
  partner_id: string;
  title: string;
  image_url: string | null;
  is_promotion: boolean;
  created_at: string;
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
  let query = supabase.from('packages').select('*').eq('partner_id', partnerId);
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
    .single();
  if (error) throw error;
  return data;
}

// Used by the optional hotel/transport package pickers in the booking form
export async function fetchPackagesByCategory(dbCategories: string[]): Promise<Package[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('packages')
    .select('*, partners!inner(id, name, category, status)')
    .in('partners.category', dbCategories)
    .eq('partners.status', 'active')
    .order('title', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
