// middleware.ts
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { createServiceClient } from './lib/supabase/service';

const intlMiddleware = createMiddleware(routing);

// Routes ที่ไม่ต้องมี locale prefix เลย (ไม่เปลี่ยนจากเดิม)
const PUBLIC_NON_LOCALE_ROUTES = ['/admin', '/login', '/quote'];

// ⭐ หน้าสาธารณะที่อยู่ใต้ [locale] (ตรงกับชื่อโฟลเดอร์จริงใน src/app/[locale]/)
// เทียบกับ path ที่ "ตัด locale prefix ออกแล้ว" (rest) ไม่ใช่ path เต็ม
// เพิ่มหน้า public ใหม่ใต้ [locale] แล้วอย่าลืมเพิ่มชื่อไว้ที่นี่ด้วย
const PUBLIC_LOCALE_ROUTE_SEGMENTS = [
  'become-partner',
  'booking',
  'category',
  // Landing page for the admin "ดูแทนพาร์ทเนอร์" (impersonation) magic
  // link — see /api/admin/partners/[id]/impersonate/route.ts and
  // impersonate-consume/page.tsx. Same reasoning as 'set-password'
  // below: the session lives in the URL hash fragment on first load,
  // which never reaches this middleware, only client-side JS.
  'impersonate-consume',
  'knowledge',
  'my-trip',
  'partner',
  'partners',
  'privacy',
  'program',
  'quote',
  // Invite-link landing page for newly provisioned partners (see
  // /api/admin/partners/provision/route.ts's inviteUserByEmail redirectTo).
  // MUST stay public: the session from the invite link is only in the URL
  // hash fragment on first load, which never reaches this middleware (the
  // browser never sends fragments to the server) — only client-side JS via
  // supabase-js's detectSessionInUrl can read it. If this were gated as a
  // portal route, the very first request would 401/redirect to /login
  // before that client JS ever ran, since middleware would see no cookie.
  'set-password',
];

function isNonLocaleRoute(pathname: string): boolean {
  return PUBLIC_NON_LOCALE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

// ตัด locale prefix ออกจาก pathname ถ้ามี
// คืนค่า locale (null ถ้าไม่มี prefix) และ rest (path ที่เหลือ ขึ้นต้นด้วย '/' เสมอ)
function stripLocale(pathname: string): { locale: string | null; rest: string } {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) {
      return { locale, rest: '/' };
    }
    if (pathname.startsWith(`/${locale}/`)) {
      return { locale, rest: pathname.slice(`/${locale}`.length) };
    }
  }
  return { locale: null, rest: pathname };
}

// ⭐ Pattern-based แทน manual whitelist (แก้ปัญหาที่ /analytics เคย 404
// เพราะลืมเพิ่มชื่อ path ไว้ในรายการ — ดู PROJECT_STRUCTURE.md ข้อ 4.7)
//
// ตอนนี้ (partner-portal) ย้ายเข้าไปอยู่ใต้ [locale] แล้ว (มี locale prefix เหมือนหน้า
// สาธารณะทุกหน้า) ดังนั้นแยกไม่ได้จาก "ไม่มี locale prefix" อีกต่อไป — ต้องแยกจาก
// "rest" (path หลังตัด locale ออก) เทียบกับหน้าสาธารณะที่รู้จักแทน
// ถ้า rest ไม่ตรงกับหน้าสาธารณะกลุ่มใดเลย = เป็นหน้าใน (partner-portal)/ โดยอัตโนมัติ
//
// 2026-08: ผลลัพธ์ของฟังก์ชันนี้ตอนนี้ถูก re-use เป็น single source of
// truth สำหรับอีกเรื่องด้วย — บอก [locale]/layout.tsx ว่าไม่ต้องเรนเดอร์
// Header/Footer/WhatsAppButton/JourneyCartBar ของเว็บสาธารณะซ้อนทับ
// PartnerHeader/PartnerSidebar ของตัวเอง (เดิมทั้งสองชุดเรนเดอร์ซ้อนกัน
// เพราะ (partner-portal) อยู่ใต้ [locale]/layout.tsx ซึ่งครอบทุกหน้า)
// ดู PARTNER_PORTAL_HEADER_FIX.md
function isPartnerPortalRest(rest: string): boolean {
  if (rest === '/') return false;
  return !PUBLIC_LOCALE_ROUTE_SEGMENTS.some(
    (segment) => rest === `/${segment}` || rest.startsWith(`/${segment}/`)
  );
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ต้องสร้าง response ตัวนี้ไว้ก่อน เพื่อให้ Supabase set/remove cookie ได้จริง
  const response = NextResponse.next({ request });

  // 1. Non-locale routes (/admin, /login, /quote แบบไม่มี locale) ไม่ต้องผ่าน
  //    next-intl และไม่ต้องผ่าน auth guard ของ partner portal
  if (isNonLocaleRoute(pathname)) {
    return response;
  }

  const { locale, rest } = stripLocale(pathname);

  // 2. ไม่มี locale prefix เลย (เช่น ลิงก์เก่า /dashboard ก่อนย้ายเข้า [locale])
  //    ปล่อยให้ next-intl redirect ไปเติม prefix ก่อน แล้วรอบถัดไปค่อยเช็ค auth
  //    (เช็ค auth ตอนนี้ไม่มีประโยชน์ เพราะ browser จะถูก redirect อยู่ดี)
  if (locale === null) {
    return intlMiddleware(request);
  }

  const partnerPortal = isPartnerPortalRest(rest);

  // Partner portal is intentionally Thai-only — partners use Thai, and
  // none of its pages/components go through next-intl (all hardcoded
  // Thai strings, see PARTNER_PORTAL_HEADER_FIX.md history). Redirect
  // /lo/... and /en/... portal URLs to their /th/... equivalent instead
  // of rendering hardcoded Thai text under a lo/en URL, which looked
  // like garbled/wrong-language text to non-Thai-locale visitors.
  // Query string carries over automatically since we only rewrite
  // pathname on the existing request URL.
  if (partnerPortal && locale !== 'th') {
    const url = new URL(request.url);
    url.pathname = `/th${rest}`;
    return NextResponse.redirect(url);
  }

  // 2026-08: inject request header ให้ [locale]/layout.tsx อ่านได้ผ่าน
  // headers() — ต้องทำก่อนเรียก intlMiddleware(request) เพื่อให้ header
  // นี้ติดไปกับ request เดียวกันที่ next-intl ใช้สร้าง response สุดท้าย
  // (ทั้ง redirect/rewrite/next case ของ next-intl เอง)
  request.headers.set('x-partner-portal', partnerPortal ? '1' : '0');

  // 3. มี locale prefix แล้ว และ rest ไม่ตรงกับหน้าสาธารณะ = partner portal route
  if (partnerPortal) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        // Isolated from the admin cookie (see src/lib/supabase/client.ts's
        // comment) — must match login/page.tsx and set-password/page.tsx's
        // createClient('partner') exactly.
        cookieOptions: { name: 'sb-wos-partner' },
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            response.cookies.set({ name, value, ...options });
          },
          remove(name: string, options: CookieOptions) {
            response.cookies.set({ name, value: '', ...options });
          },
        },
      }
    );

    // getUser() ไม่ใช่ getSession() — verify กับ Supabase Auth server จริง
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // SECURITY: a valid Supabase Auth session only proves *someone*
    // logged in — it says nothing about whether they're a partner-
    // portal user. Before this check, any Supabase Auth account
    // (including one with no row in public.users at all) could pass
    // this guard and reach the portal UI. API routes/RLS still gate
    // the actual data (defense-in-depth held), but the UI itself
    // should not render for an unlinked account. Checked via the
    // service client because public.users' RLS policy keys off JWT
    // user_metadata.organization_id, which nothing in this codebase
    // currently sets on sign-up/invite — so an anon-key read here
    // would incorrectly deny every real partner user too.
    const service = createServiceClient();
    const { data: partnerUser, error: partnerUserErr } = await service
      .from('users')
      .select('id, status')
      .eq('supabase_user_id', user.id)
      .maybeSingle();

    if (partnerUserErr) {
      console.error('[middleware] partner user lookup failed:', partnerUserErr);
      // Fail closed — an auth-adjacent DB error shouldn't silently
      // grant portal access.
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (!partnerUser || partnerUser.status !== 'active') {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      loginUrl.searchParams.set('error', 'not_a_partner_user');
      return NextResponse.redirect(loginUrl);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[middleware] partner-portal auth ok: ${pathname} (locale=${locale})`);
    }
  }

  // 4. ให้ next-intl จัดการ locale resolve/rewrite ตามปกติ (ทั้ง public และ portal
  //    เพราะทั้งคู่อยู่ใต้ [locale] แล้ว)
  const intlResponse = intlMiddleware(request);

  response.cookies.getAll().forEach((cookie) => {
    intlResponse.cookies.set(cookie);
  });

  return intlResponse;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
