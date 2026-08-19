// src/lib/admin/with-refreshed-cookies.ts
//
// Shared by every admin API route that calls requireAdmin().
//
// requireAdmin() is given a "cookie carrier" NextResponse so that, if
// Supabase refreshes the user's access/refresh token mid-request, the
// new cookies get written into that carrier via setAll(). This helper
// copies those cookies onto the real outgoing response so the browser
// actually receives them — otherwise a refreshed token only lives for
// that one request and the client keeps sending the stale, soon-to-be-
// expired cookie, causing intermittent 401s.
//
// Usage in a route handler:
//
//   const cookieCarrier = new NextResponse();
//   const auth = await requireAdmin(cookieCarrier);
//   if (!auth.authorized) {
//     return withRefreshedCookies(
//       NextResponse.json({ error: auth.message }, { status: auth.status }),
//       cookieCarrier
//     );
//   }
//   ...
//   return withRefreshedCookies(NextResponse.json({ ... }), cookieCarrier);

import type { NextResponse } from 'next/server';

export function withRefreshedCookies(res: NextResponse, carrier: NextResponse): NextResponse {
  carrier.cookies.getAll().forEach((cookie) => {
    res.cookies.set(cookie);
  });
  return res;
}
