// src/app/api/partner/orders/[id]/route.ts
//
// GET /api/partner/orders/:id
//
// Single order, with `items` filtered to only the ones the calling
// partner owns. Used by BookingDetailModal.tsx (replaces its old
// direct `.from('partner_bookings').select('*').eq('id', bookingId)`
// call). See src/lib/partner/orders.ts for the ownership-filtering
// logic.

import { NextResponse } from 'next/server';
import { getPartnerSession } from '@/lib/partner/auth';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { getPartnerOrderById } from '@/lib/partner/orders';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
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
    return withRefreshedCookies(
      NextResponse.json({ error: 'Order not found' }, { status: 404 }),
      cookieCarrier
    );
  }

  try {
    const order = await getPartnerOrderById(partnerId, params.id);
    if (!order) {
      // Either it doesn't exist, or it exists but none of its items
      // belong to this partner — same response either way.
      return withRefreshedCookies(
        NextResponse.json({ error: 'Order not found' }, { status: 404 }),
        cookieCarrier
      );
    }
    return withRefreshedCookies(NextResponse.json({ order }), cookieCarrier);
  } catch (err) {
    console.error('GET /api/partner/orders/[id] failed:', err);
    return withRefreshedCookies(
      NextResponse.json({ error: 'failed to load order' }, { status: 500 }),
      cookieCarrier
    );
  }
}
