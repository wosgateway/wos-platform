import { createServiceClient } from '@/lib/supabase/service';

export async function searchCatalog(query: string) {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('packages')
    .select(`
      id,
      title,
      description,
      category,
      sub_category,
      original_price,
      special_price,
      duration,
      duration_minutes,
      partner_id,
      partners!inner (
        id,
        name,
        category,
        province,
        status
      )
    `)
    .eq('status', 'published')
    .eq('is_active', true)
    .eq('partners.status', 'active')
    .or(`title.ilike.%${query}%,description.ilike.%${query}%,category.ilike.%${query}%,sub_category.ilike.%${query}%`)
    .limit(10);

  if (error) throw error;

  return data ?? [];
}
