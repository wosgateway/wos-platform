// middleware.ts
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

// Routes ที่ไม่ต้องมี locale prefix และไม่ต้องผ่าน auth guard ของ partner portal
// (เว็บสาธารณะทุก route จะมี locale prefix เสมอ — /admin กับ /login เป็นข้อยกเว้นเดียว)
const PUBLIC_NON_LOCALE_ROUTES = ['/admin', '/login', '/quote'];

function isNonLocaleRoute(pathname: string): boolean {
  return PUBLIC_NON_LOCALE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

function isLocaleRoute(pathname: string): boolean {
  return routing.locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)
  );
}

// ⭐ Pattern-based แทน manual whitelist (แก้ปัญหาที่ /analytics เคย 404
// เพราะลืมเพิ่มชื่อ path ไว้ในรายการ — ดู PROJECT_STRUCTURE.md ข้อ 4.7)
//
// Logic: path ที่ผ่าน matcher มาถึงตรงนี้ได้ (ไม่ใช่ /api, /_next, ไฟล์ static)
// มีอยู่ 3 กลุ่มเท่านั้น: (1) root '/' ที่ next-intl จะ redirect ไป locale เอง
// (2) locale route ของเว็บสาธารณะ (3) /admin กับ /login
// ถ้าไม่เข้าเงื่อนไข 3 กลุ่มนี้เลย แปลว่าเป็นหน้าใน (partner-portal)/ โดยอัตโนมัติ
// เพิ่มหน้าใหม่ในโฟลเดอร์นี้ได้เลยโดยไม่ต้องมาแก้ middleware.ts อีก
function isPartnerPortalRoute(pathname: string): boolean {
  if (pathname === '/') return false;
  if (isNonLocaleRoute(pathname)) return false;
  if (isLocaleRoute(pathname)) return false;
  return true;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ต้องสร้าง response ตัวนี้ไว้ก่อน เพื่อให้ Supabase set/remove cookie ได้จริง
  // (ของเดิม cookies.set/remove เป็นแค่ comment stub ไม่ได้ผูกกับ response จริง
  // แปลว่า session refresh ไม่ทำงานจริงมาตลอด — แก้ในรอบนี้ด้วย)
  let response = NextResponse.next({ request });

  // 1. ตรวจสอบ auth สำหรับ partner portal routes
  if (isPartnerPortalRoute(pathname)) {
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

    // ⭐ getUser() ไม่ใช่ getSession() — getSession() อ่าน JWT จาก cookie เฉยๆ
    // ไม่ได้ verify กับ Supabase Auth server จริง เหมือนที่แก้ใน src/lib/partner/auth.ts แล้ว
    // (ดู PROJECT_STRUCTURE.md > lib/partner/auth.ts)
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // TODO: ตรวจสอบ role/claim ว่าเป็น partner user หรือไม่ (ยังไม่ทำ)
    // ถ้าไม่ใช่ partner user ควร redirect ไปหน้า / หรือ 401

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[middleware] partner-portal auth ok: ${pathname}`);
    }
  }

  // 2. Non-locale routes (/admin, /login) ไม่ต้องผ่าน next-intl middleware
  if (isNonLocaleRoute(pathname)) {
    return response;
  }

  // 3. ให้ next-intl จัดการ locale detect/redirect/rewrite
  const intlResponse = intlMiddleware(request);

  // รวม cookie ที่ Supabase เพิ่ง set ไว้ (ถ้ามี) เข้ากับ response ของ next-intl
  // เพื่อไม่ให้ session refresh คนละ response กันหาย
  response.cookies.getAll().forEach((cookie) => {
    intlResponse.cookies.set(cookie);
  });

  return intlResponse;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
