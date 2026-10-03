import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const packageId = url.searchParams.get('package_id')?.trim() ?? '';
  const checkin = url.searchParams.get('checkin')?.trim() ?? '';
  const checkout = url.searchParams.get('checkout')?.trim() ?? '';
  const rooms = Number(url.searchParams.get('rooms') ?? '1');

  if (!packageId || !isISODate(checkin) || !isISODate(checkout)) {
    return NextResponse.json({ error: 'package_id, checkin and checkout are required' }, { status: 400 });
  }
  if (!Number.isInteger(rooms) || rooms <= 0 || rooms > 100) {
    return NextResponse.json({ error: 'rooms must be a whole number between 1 and 100' }, { status: 400 });
  }

  const start = new Date(checkin + 'T00:00:00Z');
  const end = new Date(checkout + 'T00:00:00Z');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return NextResponse.json({ error: 'checkout must be after checkin' }, { status: 400 });
  }

  const nights = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (nights > 90) {
    return NextResponse.json({ error: 'stay cannot exceed 90 nights' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: pkg, error: packageError } = await supabase
    .from('packages')
    .select('id, status, is_active, partner:partners!inner(category, status)')
    .eq('id', packageId)
    .eq('status', 'published')
    .maybeSingle();

  if (packageError) {
    console.error('hotel availability package lookup failed:', packageError);
    return NextResponse.json({ error: 'failed to check hotel availability' }, { status: 500 });
  }

  const partner = Array.isArray(pkg?.partner) ? pkg?.partner[0] : pkg?.partner;
  if (!pkg || pkg.is_active === false || partner?.category !== 'Hotel' || partner?.status !== 'active') {
    return NextResponse.json({ error: 'hotel package is not bookable' }, { status: 400 });
  }

  const { data: rows, error } = await supabase
    .from('room_availability')
    .select('date, available_count, price_override')
    .eq('package_id', packageId)
    .gte('date', checkin)
    .lt('date', checkout)
    .order('date', { ascending: true });

  if (error) {
    console.error('hotel availability lookup failed:', error);
    return NextResponse.json({ error: 'failed to check hotel availability' }, { status: 500 });
  }

  const byDate = new Map((rows ?? []).map((row) => [row.date, row]));
  const days = Array.from({ length: nights }, (_, index) => {
    const date = addDaysISO(checkin, index);
    const row = byDate.get(date);
    return {
      date,
      available_count: row?.available_count ?? null,
      price_override: row?.price_override ?? null,
      available: row != null && row.available_count >= rooms,
    };
  });

  return NextResponse.json({
    package_id: packageId,
    checkin,
    checkout,
    rooms,
    nights,
    available: days.every((day) => day.available),
    days,
  });
}
