import { createServerClient, type CookieOptions } from '@supabase/ssr';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  // 1. Let next-intl decide/redirect on locale first — except /admin,
  //    which isn't locale-prefixed (internal Thai-only tool). Without
  //    this check next-intl would redirect /admin to /th/admin and the
  //    route would never match src/app/admin/page.tsx.
  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin');
  const response = isAdminRoute ? NextResponse.next() : intlMiddleware(request);

  // 2. Refresh the Supabase auth session on every request so admin
  //    login (supabase.auth.signInWithPassword) stays valid across
  //    server components — this is what replaces the old client-only
  //    "sessionStorage gate" pattern from admin.html.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options) {
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
