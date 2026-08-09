import { requireAdmin } from '@/lib/admin/require-admin';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = "force-dynamic";

// Supabase can return a belongs-to relation as either an object or a
// single-element array depending on how the FK is inferred — this
// normalizes both cases before we read `.category`.
function getPartnerCategory(partners: unknown): string | null {
  const p = Array.isArray(partners) ? partners[0] : partners;
  return (p as { category?: string } | null)?.category ?? null;
}

export async function GET(request: NextRequest) {
  try {
    // ตรวจสอบสิทธิ์ Admin
    const auth = await requireAdmin();
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const categories = (searchParams.get('categories')?.split(',') || []).filter(Boolean);

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
      .not('partners', 'is', null);  // ← เอาเฉพาะที่มี partner จริง

    if (error) {
      console.error('Error fetching packages:', error);
      return NextResponse.json(
        { error: 'Failed to fetch packages' },
        { status: 500 }
      );
    }

    const all = data || [];

    // ไม่ระบุ categories -> คืนค่าแบบเดิม (array เดียว) เพื่อไม่พังการใช้งานเดิมที่อื่น
    if (categories.length === 0) {
      return NextResponse.json({ packages: all });
    }

    // ระบุ categories -> จัดกลุ่มเป็น { <category ตัวเล็ก>: [...] }
    // เทียบแบบ case-insensitive เผื่อ DB เก็บ 'hotel'/'transport' ตัวเล็ก
    // แต่ query string ส่งมาเป็น 'Hotel'/'Transport' ตัวใหญ่
    const grouped: Record<string, typeof all> = {};
    for (const cat of categories) {
      const key = cat.toLowerCase();
      grouped[key] = all.filter(
        (pkg) => (getPartnerCategory(pkg.partners) || '').toLowerCase() === key
      );
    }

    return NextResponse.json(grouped);
  } catch (error) {
    console.error('Error in /api/admin/packages/pickers:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
