// src/middleware.ts
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

const PUBLIC_NON_LOCALE_ROUTES = ['/admin', '/login'];
const PARTNER_PORTAL_ROUTES = ['/dashboard', '/bookings', '/packages', '/company', '/documents', '/billing', '/analytics'];

function isNonLocaleRoute(pathname: string): boolean {
  return (
    PUBLIC_NON_LOCALE_ROUTES.some(route => pathname.startsWith(route)) ||
    PARTNER_PORTAL_ROUTES.some(route => pathname.startsWith(route))
  );
}

function isPartnerPortalRoute(pathname: string): boolean {
  return PARTNER_PORTAL_ROUTES.some(route => pathname.startsWith(route));
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 1. Base response (next-intl handles locale routing, plain pass-through otherwise)
  let response = isNonLocaleRoute(pathname)
    ? NextResponse.next({ request })
    : intlMiddleware(request);

  // 2. ONE Supabase client, current getAll/setAll API — refresh happens BEFORE any auth check
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // sync onto the request first so this same middleware run sees fresh cookies
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // rebuild response so the refreshed cookies actually reach the browser
          response = isNonLocaleRoute(pathname)
            ? NextResponse.next({ request })
            : intlMiddleware(request);
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() actually validates/refreshes against Supabase Auth — not getSession()
  const { data: { user }, error } = await supabase.auth.getUser();

  if (process.env.NODE_ENV !== 'production') {
    console.log('[middleware]', { pathname, hasUser: !!user, error: error?.message });
  }

  // 3. Guard partner portal routes AFTER refresh
  if (isPartnerPortalRoute(pathname) && !user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // TODO: ตรวจสอบ role/claim ว่าเป็น partner user หรือไม่ (ใช้ user.app_metadata / user.user_metadata)

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};