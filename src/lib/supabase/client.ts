import { createBrowserClient } from '@supabase/ssr';

/**
 * Client-side Supabase instance.
 * Replaces the old window.__supabase pattern from js/main.js —
 * every page used to re-declare SUPABASE_URL/ANON_KEY; now it's one
 * source of truth reading from env vars instead of being hardcoded.
 *
 * Optional `namespace` isolates the admin UI's Auth session from the
 * partner portal's, so a partner org's staff signed in at
 * /partner/login can't also open /admin using the same browser
 * cookie, and vice versa. Cookie names here MUST match the
 * server-side clients that read the same session:
 *   - 'admin'   -> 'sb-wos-admin'   (see src/lib/admin/require-admin.ts)
 *   - 'partner' -> 'sb-wos-partner' (see src/middleware.ts)
 * Calling createClient() with no namespace keeps the default cookie
 * name — fine for public-facing pages with no admin/partner session
 * to isolate (customer booking forms, etc).
 */
const COOKIE_NAMES = {
  admin: 'sb-wos-admin',
  partner: 'sb-wos-partner',
} as const;

export function createClient(namespace?: keyof typeof COOKIE_NAMES) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    namespace ? { cookieOptions: { name: COOKIE_NAMES[namespace] } } : undefined
  );
}
