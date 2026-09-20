import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Step 1 of the two-step hotel/transport reassignment picker in
// BookingsManager.tsx (via PackagePickerCombobox): "pick a partner"
// before "pick a package". Kept as its own tiny endpoint rather than
// piggybacking on /api/admin/packages/pickers because the partner
// list is the smaller, cheaper dataset to search — with 100+ partners
// nationwide, letting the admin narrow to one partner first (by name
// or province) before ever loading that partner's packages is what
// actually solves the "dropdown with hundreds of rows" problem.
//
// Same `partners.category` CHECK constraint values as
// /api/admin/packages/pickers (Hospital/Clinic/Dental/Wellness/Spa/
// Hotel/Transport) — see sql/006_legacy_directory_tables.sql.

type PartnerRow = {
  id: string;
  name: string;
  category: string;
  province: string | null;
};

const MAX_RESULTS_PER_CATEGORY = 200;

export async function GET(request: NextRequest) {
  const cookieCarrier = new NextResponse();

  try {
    const auth = await requireAdmin(cookieCarrier);

    if (!auth.authorized) {
      return withRefreshedCookies(
        NextResponse.json({ error: auth.message }, { status: auth.status }),
        cookieCarrier
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const categories = (searchParams.get('categories')?.split(',') || [])
      .map((value) => value.trim())
      .filter(Boolean);
    // Matches partner name OR province — lets an admin type either
    // "อุดรแก้วทัวร์" or "อุดรธานี" and find the same partner.
    const search = searchParams.get('search')?.trim() || '';

    if (categories.length === 0) {
      return withRefreshedCookies(
        NextResponse.json({ error: 'categories query param is required' }, { status: 400 }),
        cookieCarrier
      );
    }

    const supabase = await createClient();

    let query = supabase
      .from('partners')
      .select('id, name, category, province')
      .eq('status', 'active')
      .in('category', categories)
      .order('province', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true })
      .limit(MAX_RESULTS_PER_CATEGORY);

    if (search) {
      query = query.or(`name.ilike.%${search}%,province.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching partners:', error);
      return withRefreshedCookies(
        NextResponse.json({ error: 'Failed to fetch partners' }, { status: 500 }),
        cookieCarrier
      );
    }

    const all = (data ?? []) as PartnerRow[];

    // Grouped by category (lowercased key), same convention as
    // /api/admin/packages/pickers, so the client can request
    // ?categories=Hotel,Transport in one call if it ever needs both.
    const grouped: Record<string, PartnerRow[]> = {};
    for (const cat of categories) {
      const key = cat.toLowerCase();
      grouped[key] = all.filter((p) => p.category === cat);
    }

    return withRefreshedCookies(NextResponse.json(grouped), cookieCarrier);
  } catch (error) {
    console.error('Error in /api/admin/partners/pickers:', error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
      cookieCarrier
    );
  }
}
