import { createServiceClient } from '@/lib/supabase/service';

type HotelAvailabilityInput = {
  province: string;
  checkin: string;
  checkout: string;
  rooms: number;
  limit?: number;
};

type HotelAvailabilityResult = {
  id: string;
  title: string;
  room_type?: string | null;
  partner: { name: string; province?: string | null };
  price_per_night: number | null;
  base_price_per_night: number | null;
  currency: 'THB';
  nights: number;
  rooms: number;
  total_estimated: number | null;
  available: boolean;
  days: Array<{
    date: string;
    available_count: number | null;
    price_per_night: number | null;
    available: boolean;
  }>;
};

function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function searchHotelAvailability(
  input: HotelAvailabilityInput
): Promise<HotelAvailabilityResult[]> {
  const province = input.province.trim();
  const checkin = input.checkin.trim();
  const checkout = input.checkout.trim();
  const rooms = Number(input.rooms ?? 1);
  const limit = Math.min(Math.max(Number(input.limit ?? 5), 1), 5);

  if (!province || !isISODate(checkin) || !isISODate(checkout)) return [];
  if (!Number.isInteger(rooms) || rooms <= 0 || rooms > 10) return [];

  const start = new Date(checkin + 'T00:00:00Z');
  const end = new Date(checkout + 'T00:00:00Z');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return [];

  const nights = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (nights > 90) return [];

  const supabase = createServiceClient();
  const { data: packages, error: packageError } = await supabase
    .from('packages')
    .select(
      'id, title, original_price, special_price, is_promotion, sub_category, max_guests, partners!inner(id, name, category, status, province)'
    )
    .eq('status', 'published')
    .eq('is_active', true)
    .eq('partners.category', 'Hotel')
    .eq('partners.status', 'active')
    .eq('partners.province', province)
    .limit(20);

  if (packageError) {
    console.error('[WOS_AI_HOTEL] package search failed:', packageError);
    return [];
  }

  const packageIds = (packages ?? []).map((pkg) => pkg.id);
  if (packageIds.length === 0) return [];

  const { data: rows, error } = await supabase
    .from('room_availability')
    .select('package_id, date, available_count, price_override')
    .in('package_id', packageIds)
    .gte('date', checkin)
    .lt('date', checkout)
    .order('date', { ascending: true });

  if (error) {
    console.error('[WOS_AI_HOTEL] availability lookup failed:', error);
    return [];
  }

  const byPackage = new Map<string, typeof rows>();
  for (const row of rows ?? []) {
    const current = byPackage.get(row.package_id) ?? [];
    current.push(row);
    byPackage.set(row.package_id, current);
  }

  const results: HotelAvailabilityResult[] = [];

  for (const pkg of packages ?? []) {
    const partner = Array.isArray(pkg.partners) ? pkg.partners[0] : pkg.partners;
    const packageRows = byPackage.get(pkg.id) ?? [];
    const byDate = new Map(packageRows.map((row) => [row.date, row]));
    const days: HotelAvailabilityResult['days'] = [];

    for (let index = 0; index < nights; index++) {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + index);
      const iso = date.toISOString().slice(0, 10);
      const row = byDate.get(iso);
      const availableCount = row?.available_count ?? null;
      const price = row?.price_override ?? null;
      days.push({
        date: iso,
        available_count: availableCount,
        price_per_night: price == null ? null : Number(price),
        available: row != null && Number(availableCount) >= rooms,
      });
    }

    if (!days.every((day) => day.available)) continue;

    const basePrice =
      pkg.special_price != null
        ? Number(pkg.special_price)
        : pkg.original_price != null
          ? Number(pkg.original_price)
          : null;

    const firstOverride = days.find((day) => day.price_per_night != null)?.price_per_night ?? null;
    const pricePerNight = firstOverride ?? basePrice;
    const allSamePrice = days.every(
      (day) => (day.price_per_night ?? basePrice) === pricePerNight
    );

    results.push({
      id: String(pkg.id),
      title: String(pkg.title ?? ''),
      room_type: pkg.sub_category == null ? null : String(pkg.sub_category),
      partner: {
        name: String(partner?.name ?? ''),
        province: partner?.province == null ? null : String(partner.province),
      },
      price_per_night: allSamePrice ? pricePerNight : null,
      base_price_per_night: basePrice,
      currency: 'THB',
      nights,
      rooms,
      total_estimated:
        allSamePrice && pricePerNight != null
          ? pricePerNight * nights * rooms
          : null,
      available: true,
      days,
    });
  }

  return results.slice(0, limit);
}
