// src/app/api/partner/orders/route.ts
//
// GET /api/partner/orders
//
// Replacement read path for the old `partner_bookings` queries in
// RecentBookings.tsx / BookingsList.tsx / ExportBookings.tsx /
// AnalyticsDashboard.tsx. See src/lib/partner/orders.ts for why this
// has to go through the service-role client rather than the browser's
// session client — `customers` has no partner-readable RLS policy.

import { NextResponse } from 'next/server';
import { getPartnerSession } from '@/lib/partner/auth';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { getPartnerOrders } from '@/lib/partner/orders';

// Same reasoning as /api/admin/orders/route.ts: never let Next.js
// static-cache this — bookings/status changes must show up on refresh.
export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieCarrier = new NextResponse();
  const { user } = await getPartnerSession(cookieCarrier);

  if (!user) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      cookieCarrier
    );
  }

  const partnerId = user.branch?.partner_id ?? null;
  if (!partnerId) {
    // Same "user not linked to a branch/partner yet" case
    // DashboardMetrics.tsx handles — empty list instead of an error.
    return withRefreshedCookies(NextResponse.json({ orders: [] }), cookieCarrier);
  }

  try {
    const orders = await getPartnerOrders(partnerId);
    return withRefreshedCookies(NextResponse.json({ orders }), cookieCarrier);
  } catch (err) {
    console.error('GET /api/partner/orders failed:', err);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load orders' }, { status: 500 }),
      cookieCarrier
    );
  }
}
