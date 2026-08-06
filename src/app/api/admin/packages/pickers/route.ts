import { requireAdmin } from '@/lib/admin/require-admin';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    // ตรวจสอบสิทธิ์ Admin
    const auth = await requireAdmin();
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const categories = searchParams.get('categories')?.split(',') || [];

    const supabase = await createClient();

    let query = supabase
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
      .not('partners', 'is', null);  // ← เอาเฉพาะที่มี partner จริง

    // ถ้ามี categories ให้ filter
    if (categories.length > 0 && categories[0] !== '') {
      query = query.in('partners.category', categories);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching packages:', error);
      return NextResponse.json(
        { error: 'Failed to fetch packages' },
        { status: 500 }
      );
    }

    return NextResponse.json({ packages: data || [] });
  } catch (error) {
    console.error('Error in /api/admin/packages/pickers:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}