import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

/**
 * Root cause of "supabaseUrl is required" in the AI search path
 * (searchPrograms -> data.ts -> createAnonClient()) even when the running
 * container's env clearly has NEXT_PUBLIC_SUPABASE_URL/ANON_KEY set:
 *
 * Next.js inlines every `process.env.NEXT_PUBLIC_*` reference into a
 * literal value AT BUILD TIME (`next build`, i.e. during `docker build`
 * here) - for BOTH client and server compiled output, not only code that
 * ends up in the browser bundle. If those two vars were not present as
 * build-time ARG/ENV when the image was built (only passed later via
 * `docker run --env-file`), every reference below was already replaced
 * with the literal `undefined` inside the compiled .next output - no
 * runtime env var can change that afterwards. That's why constructing a
 * client directly in the running container works (that's a fresh,
 * un-inlined process.env read) while the exact same call inside the built
 * app fails.
 *
 * Fix: read a plain (non-NEXT_PUBLIC_) SUPABASE_URL/SUPABASE_ANON_KEY
 * first - Next.js does NOT inline these, so they are read live from
 * process.env at request time on the server, same as SUPABASE_URL already
 * is in supabase/service.ts. Falls back to the NEXT_PUBLIC_ names so this
 * still works unchanged wherever only those are set (e.g. Vercel, where
 * NEXT_PUBLIC_* are supplied at build time correctly). Add
 * SUPABASE_ANON_KEY=<same value as NEXT_PUBLIC_SUPABASE_ANON_KEY> to the
 * local/candidate env file to take the fast path here.
 */
function resolveSupabasePublicConfig(): { url: string; anonKey: string } {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing SUPABASE_URL/SUPABASE_ANON_KEY (or NEXT_PUBLIC_ fallback) — Supabase client cannot be created.'
    );
  }

  return { url, anonKey };
}

/**
 * Server-side Supabase instance (Server Components, Route Handlers).
 * Needed for the new admin auth flow (supabase.auth.signInWithPassword)
 * so the session persists via cookies instead of only living in the browser.
 *
 * Use this ONLY when the query actually needs the visitor's session
 * (partner portal pages, admin API routes). For public reads that never
 * touch a user's identity (packages/partners lists on the public site),
 * use createAnonClient() below instead — see its comment for why.
 *
 * OPTIONAL `response` ("cookie carrier"): pass a NextResponse from a
 * Route Handler when this client might trigger a Supabase session
 * refresh (e.g. via auth.getSession()/getUser()) — same pattern as
 * requireAdmin() in src/lib/admin/require-admin.ts, and for the same
 * reason: without it, a refreshed access/refresh token pair only
 * lives in-memory for this one request, and the browser keeps
 * sending the stale, soon-to-be-expired cookie, causing intermittent
 * 401s. When no response is passed (Server Components, or route
 * handlers that don't need it), cookies are written directly via
 * cookieStore.set(), same as before — Server Component calls remain
 * a safe no-op there, relying on middleware to refresh the session.
 */
export function createClient(response?: NextResponse) {
  const cookieStore = cookies();
  const { url, anonKey } = resolveSupabasePublicConfig();

  return createServerClient(
    url,
    anonKey,
    {
      cookieOptions: {
        name: 'sb-wos-partner',
      },
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          if (response) {
            response.cookies.set(name, value, options);
            return;
          }
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component — safe to ignore when
            // middleware is refreshing the session.
          }
        },
        remove(name: string, options: CookieOptions) {
          if (response) {
            response.cookies.set(name, '', options);
            return;
          }
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // Same as above.
          }
        },
      },
    }
  );
}

/**
 * Cookie-free Supabase client for public reads that never depend on who's
 * visiting (src/lib/data.ts: published packages, active partners — all
 * anon-readable by RLS regardless of login state).
 *
 * Why this exists: createClient() above wires up the visitor's auth
 * cookies via @supabase/ssr so it can attempt a session refresh on every
 * call. If the browser is holding a stale/expired refresh token (e.g.
 * leftover from an admin test login, or from before a Supabase project/env
 * var change), that refresh attempt throws
 * "AuthApiError: Invalid Refresh Token: Refresh Token Not Found" —
 * harmless for these queries (the request still returns 200) but noisy in
 * logs, and wasteful: none of the public data.ts queries need a session at
 * all. This client skips cookies/auth entirely, so there's nothing to
 * refresh and nothing to fail.
 *
 * Same shape as createServiceClient() in supabase/service.ts, but with the
 * anon key (respects RLS) instead of the service-role key (bypasses RLS).
 */
export function createAnonClient() {
  const { url, anonKey } = resolveSupabasePublicConfig();

  return createSupabaseClient(
    url,
    anonKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
