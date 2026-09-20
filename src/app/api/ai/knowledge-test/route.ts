import { NextResponse } from 'next/server';
import { createAnonClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createAnonClient();

    const { data, error } = await supabase
      .from('packages')
      .select('id, title, status, is_active')
      .eq('status', 'published')
      .eq('is_active', true)
      .ilike('title', '%ตรวจ%')
      .limit(10);

    if (error) throw error;

    return NextResponse.json({
      count: data?.length ?? 0,
      items: data ?? [],
    });
  } catch (error) {
    console.error('[PROGRAM_SEARCH_TEST]', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
