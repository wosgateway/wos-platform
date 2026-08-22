import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getPartnerCategory(partners: unknown): string | null {
  const p = Array.isArray(partners) ? partners[0] : partners;
  return (p as { category?: string } | null)?.category ?? null;
}

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

    const supabase = await createClient();

    const { data, error } = await supabase
      .from('packages')
      .select(`
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
      `)
      .eq('status', 'published')
      .eq('is_active', true)
      .not('partners', 'is', null);

    if (error) {
      console.error(
        'Error fetching packages:',
        error
      );

      return withRefreshedCookies(
        NextResponse.json(
          { error: 'Failed to fetch packages' },
          { status: 500 }
        ),
        cookieCarrier
      );
    }

    const all = data ?? [];

    if (categories.length === 0) {
      return withRefreshedCookies(
        NextResponse.json({ packages: all }),
        cookieCarrier
      );
    }

    const grouped: Record<string, typeof all> = {};

    for (const cat of categories) {
      const key = cat.toLowerCase();

      grouped[key] = all.filter(
        (pkg) =>
          (getPartnerCategory(pkg.partners) || '').toLowerCase() === key
      );
    }

    return withRefreshedCookies(
      NextResponse.json(grouped),
      cookieCarrier
    );
  } catch (error) {
    console.error(
      'Error in /api/admin/packages/pickers:',
      error
    );

    return withRefreshedCookies(
      NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      ),
      cookieCarrier
    );
  }
}
