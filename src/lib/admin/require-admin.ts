// src/lib/admin/require-admin.ts
//
// Verifies the request is from a signed-in WOS platform admin.
//
// Platform admin authorization is stored in public.users.is_platform_admin
// and checked through the SECURITY DEFINER RPC function is_platform_admin().
//
// This keeps Admin UI, API routes, and database RLS using the same
// authorization rule instead of relying on separate role systems.
//
// IMPORTANT: pass a NextResponse ("cookie carrier") from the calling route
// so that a refreshed access/refresh token pair can actually be written
// back to the browser. Without this, Supabase silently refreshes the
// token in-memory for a single request but the browser cookie stays
// stale, causing intermittent 401s once the original token expires.

import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { NextResponse } from 'next/server';

type RequireAdminResult =
  | { authorized: true; user: { id: string; email?: string } }
  | { authorized: false; status: 401 | 403; message: string };

export async function requireAdmin(response?: NextResponse): Promise<RequireAdminResult> {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // If the caller gave us a response to write into, forward any
        // refreshed session cookies onto it. Otherwise no-op (falls back
        // to the old read-only behavior).
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          if (!response) return;
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      authorized: false,
      status: 401,
      message: 'not signed in',
    };
  }

  const {
    data: isPlatformAdmin,
    error: adminError,
  } = await supabase.rpc('is_platform_admin');

  if (adminError) {
    console.error('is_platform_admin RPC failed:', adminError);

    return {
      authorized: false,
      status: 403,
      message: 'admin authorization check failed',
    };
  }

  if (!isPlatformAdmin) {
    return {
      authorized: false,
      status: 403,
      message: 'platform admin required',
    };
  }

  return {
    authorized: true,
    user: {
      id: user.id,
      email: user.email,
    },
  };
}
