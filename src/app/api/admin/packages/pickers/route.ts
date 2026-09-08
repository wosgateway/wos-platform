import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Same shape the UI has always consumed — kept as-is so
// BookingsManager.tsx's PickerPackage interface doesn't need to change.
type PickerRow = {
  id: string;
  title: string;
  original_price: number | null;
  special_price: number | null;
  partner_id: string;
  partners:
    | { id: string; name: string; category: string }
    | { id: string; name: string; category: string }[]
    | null;
};

// Caps how many rows come back per category so the payload (and the
// picker UI) stays usable once there are 100+ partners nationwide.
// The combobox on the client filters further by typed query, but this
// is the ceiling on what ever gets sent down in one response. Pair
// with ?search= to narrow further server-side once a category
// regularly hits this cap.
const MAX_RESULTS_PER_CATEGORY = 50;

export async function GET(request: NextRequest) {
  const cookieCarrier = new NextResponse();

  try {
    const auth = await requireAdmin(cookieCarrier);

    if (!auth.authorized) {
      return withRefreshedCookies(
        NextResponse.json(
          { error: auth.message },
          { status: auth.status }
        ),
        cookieCarrier
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const categories = (searchParams.get('categories')?.split(',') || [])
      .map((value) => value.trim())
      .filter(Boolean);
    // Optional free-text filter on package title — lets the client-side
    // combobox ask for a narrower slice instead of always pulling
    // MAX_RESULTS_PER_CATEGORY rows per category.
    const search = searchParams.get('search')?.trim() || '';
    // Optional — scopes results to one partner's packages. This is
    // step 2 of the two-step picker (PackagePickerCombobox): once an
    // admin has picked a partner via /api/admin/partners/pickers, this
    // fetches just that partner's packages, which is always a small
    // list regardless of how many partners exist nationwide.
    const partnerId = searchParams.get('partner_id')?.trim() || '';

    const supabase = await createClient();

    // categories.length === 0 keeps the old "no filter, return
    // everything (capped)" behavior for any caller that doesn't pass
    // ?categories=.
    if (categories.length === 0) {
      let query = supabase
        .from('packages')
        .select(
          `
          id,
          title,
          original_price,
          special_price,
          partner_id,
          partners (
            id,
            name,
            category
          )
        `
        )
        .eq('status', 'published')
        .eq('is_active', true)
        .not('partners', 'is', null)
        .order('title', { ascending: true })
        .limit(MAX_RESULTS_PER_CATEGORY);

      if (search) {
        query = query.ilike('title', `%${search}%`);
      }
      if (partnerId) {
        query = query.eq('partner_id', partnerId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching packages:', error);
        return withRefreshedCookies(
          NextResponse.json({ error: 'Failed to fetch packages' }, { status: 500 }),
          cookieCarrier
        );
      }

      return withRefreshedCookies(NextResponse.json({ packages: data ?? [] }), cookieCarrier);
    }

    // One query per requested category, filtered at the database via
    // partners!inner(...).eq('partners.category', ...) — same pattern
    // fetchPackagesByCategory() in src/lib/data.ts already uses for the
    // public catalog. This replaces the old approach of fetching every
    // published/active package across every partner and filtering by
    // category in JS, which doesn't scale once there are 100+ partners
    // nationwide.
    const grouped: Record<string, PickerRow[]> = {};

    await Promise.all(
      categories.map(async (cat) => {
        const key = cat.toLowerCase();

        let query = supabase
          .from('packages')
          .select(
            `
            id,
            title,
            original_price,
            special_price,
            partner_id,
            partners!inner (
              id,
              name,
              category
            )
          `
          )
          .eq('status', 'published')
          .eq('is_active', true)
          .eq('partners.category', cat)
          .order('title', { ascending: true })
          .limit(MAX_RESULTS_PER_CATEGORY);

        if (search) {
          query = query.ilike('title', `%${search}%`);
        }
        if (partnerId) {
          query = query.eq('partner_id', partnerId);
        }

        const { data, error } = await query;

        if (error) {
          console.error(`Error fetching packages for category "${cat}":`, error);
          grouped[key] = [];
          return;
        }

        grouped[key] = (data ?? []) as unknown as PickerRow[];
      })
    );

    return withRefreshedCookies(NextResponse.json(grouped), cookieCarrier);
  } catch (error) {
    console.error('Error in /api/admin/packages/pickers:', error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
      cookieCarrier
    );
  }
}
