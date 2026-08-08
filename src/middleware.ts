// middleware.ts
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

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
  'knowledge',
  'partner',
  'program',
  'quote',
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

  // 3. มี locale prefix แล้ว และ rest ไม่ตรงกับหน้าสาธารณะ = partner portal route
  if (isPartnerPortalRest(rest)) {
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

    // TODO: ตรวจสอบ role/claim ว่าเป็น partner user หรือไม่ (ยังไม่ทำ)

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
