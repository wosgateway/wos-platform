// src/app/api/cron/expire-mou-sign-requests/route.ts
//
// One sweep, then return — same shape and same auth as
// /api/cron/trip-reminders (bearer CRON_SECRET, fails closed when
// the secret isn't configured). Nothing stays running between calls.
//
// WHY THIS EXISTS: nothing has ever written mou_sign_requests.status
// = 'expired'. PartnersManager.tsx compares token_expires_at to
// Date.now() in the browser to render its badge, which is fine for a
// badge and wrong for every server-side consumer — a request that
// lapsed two months ago still reads as 'pending' to any query,
// export or report. expire_stale_mou_sign_requests() (114) is the
// single statement that fixes that; this route is just a scheduled
// trigger for it.
//
// SCHEDULING: daily is plenty — the TTL is 14 days
// (SIGN_LINK_TTL_DAYS) and the signing page independently refuses an
// expired token via resolveSignToken() regardless of what the status
// column says, so a link is never usable past its expiry even if
// this job hasn't run. The sweep is about the *record* being
// truthful, not about access control. That also means a Hobby-plan
// once-a-day cron is genuinely sufficient here, unlike
// trip-reminders.
//
//   vercel.json:
//     { "path": "/api/cron/expire-mou-sign-requests", "schedule": "0 18 * * *" }
//   (18:00 UTC = 01:00 Asia/Bangkok — off-peak for the admin app.)
//
// Idempotent: a second run in the same minute updates zero rows, so
// a scheduler that double-fires costs nothing.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('expire_stale_mou_sign_requests');

  if (error) {
    console.error('cron expire-mou-sign-requests: rpc failed', error);
    return NextResponse.json({ error: 'sweep_failed', detail: error.message }, { status: 500 });
  }

  const expired = typeof data === 'number' ? data : 0;
  if (expired > 0) {
    // Worth a log line: a sudden spike means invitations are going
    // out and never being acted on, which is a sales problem, not a
    // technical one.
    console.log(`cron expire-mou-sign-requests: expired ${expired} stale sign request(s)`);
  }

  return NextResponse.json({ ok: true, expired });
}
