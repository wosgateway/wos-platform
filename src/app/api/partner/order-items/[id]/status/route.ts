// src/app/api/partner/order-items/[id]/status/route.ts
//
// POST /api/partner/order-items/:id/status   body: { status: string }
//
// New write path for order_items.status, replacing the direct
// `.update()` on `partner_bookings` that BookingDetailModal.tsx /
// BookingsList.tsx used to call. order_items has no partner-writable
// RLS policy (same reason `payments` doesn't — see
// /api/partner/payments/[id]/verify/route.ts), so this goes through
// the partner_update_order_item_status RPC (migration 034) via the
// service-role client. The RPC's own ownership check (order_item.
// partner_id vs p_partner_id) is defense-in-depth on top of the auth
// check below, not the primary boundary — that's why EXECUTE on the
// RPC is only granted to service_role, not to logged-in users directly.

import { NextResponse } from 'next/server';
import { getPartnerSession, hasPermission } from '@/lib/partner/auth';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

// Must match the CHECK constraint order_items.status is defined
// against (see migration 034's comment) and the enum documented in
// DashboardMetrics.tsx.
const ALLOWED_STATUSES = ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'refunded'];

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const cookieCarrier = new NextResponse();

  // 1. Auth — logged-in partner user with permission to manage
  //    bookings. Admins always pass; staff need the explicit
  //    permission (add 'manage_bookings' to a user's permissions array
  //    in Supabase if a non-admin should be allowed to change status).
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
  const newStatus = body?.status;

  if (typeof newStatus !== 'string' || !ALLOWED_STATUSES.includes(newStatus)) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'invalid status' }, { status: 400 }),
      cookieCarrier
    );
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc('partner_update_order_item_status', {
    p_order_item_id: params.id,
    p_partner_id: partnerId,
    p_new_status: newStatus,
  });

  if (error) {
    if (error.message.includes('order_item_not_found') || error.message.includes('not_owner')) {
      // Same response for "doesn't exist" vs "belongs to another
      // partner" — don't leak which.
      return withRefreshedCookies(
        NextResponse.json({ error: 'Order item not found' }, { status: 404 }),
        cookieCarrier
      );
    }
    console.error('partner_update_order_item_status failed:', error);
    return withRefreshedCookies(
      NextResponse.json({ error: error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  return withRefreshedCookies(NextResponse.json({ item: data }), cookieCarrier);
}
