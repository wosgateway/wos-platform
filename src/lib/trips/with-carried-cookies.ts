import { NextResponse } from "next/server";

/**
 * requireAdmin(response) writes refreshed Supabase session cookies onto the
 * NextResponse you pass it (see require-admin.ts's header comment — without
 * this, the browser cookie goes stale and you get intermittent 401s).
 *
 * Route handlers build their real JSON response separately (NextResponse.json
 * can't be mutated after creation the way we need), so this copies any
 * cookies requireAdmin set onto `cookieCarrier` over onto the final response
 * before it goes out.
 */
export function withCarriedCookies(cookieCarrier: NextResponse, finalResponse: NextResponse) {
  cookieCarrier.cookies.getAll().forEach((cookie) => {
    finalResponse.cookies.set(cookie);
  });
  return finalResponse;
}
