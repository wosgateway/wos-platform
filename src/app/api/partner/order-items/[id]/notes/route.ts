// src/app/api/partner/order-items/[id]/notes/route.ts
//
// POST /api/partner/order-items/:id/notes   body: { notes: string }
//
// New write path for the per-item `partner_notes` column (migration
// 034), replacing the old direct `.update({ notes })` on
// `partner_bookings` in BookingDetailModal.tsx. Deliberately writes to
// order_items.partner_notes rather than orders.notes — see migration
// 034's comment on why order-level notes aren't safe for a single
// partner to edit when an order can have other partners' items on it.
// Same RPC-via-service-role pattern as the status route next to this
// one; see that file's header for the security rationale.

import { NextResponse } from 'next/server';
import { getPartnerSession, hasPermission } from '@/lib/partner/auth';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();

  const { user } = await getPartnerSession(cookieCarrier);
  if (!user) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      cookieCarrier
    );
  }
  if (!hasPermission(user, 'manage_bookings')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      cookieCarrier
    );
  }

  const partnerId = user.branch?.partner_id ?? null;
  if (!partnerId) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'No partner linked to this account' }, { status: 403 }),
      cookieCarrier
    );
  }

  const body = await request.json().catch(() => ({}));
  const notes = typeof body?.notes === 'string' ? body.notes : '';

  const service = createServiceClient();
  const { data, error } = await service.rpc('partner_update_order_item_notes', {
    p_order_item_id: params.id,
    p_partner_id: partnerId,
    p_notes: notes,
  });

  if (error) {
    if (error.message.includes('order_item_not_found') || error.message.includes('not_owner')) {
      return withRefreshedCookies(
        NextResponse.json({ error: 'Order item not found' }, { status: 404 }),
        cookieCarrier
      );
    }
    console.error('partner_update_order_item_notes failed:', error);
    return withRefreshedCookies(
      NextResponse.json({ error: error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  return withRefreshedCookies(NextResponse.json({ item: data }), cookieCarrier);
}
