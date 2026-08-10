// lib/admin/require-admin.ts
//
// Verifies the request is from a signed-in admin, using the
// Supabase session cookie (NOT the service-role key — that's only
// pulled in after this check passes, inside each route).
//
// ⚠️ ASSUMPTION TO VERIFY: this checks `user.app_metadata.role ===
// 'admin'`. That's the common Supabase convention (app_metadata is
// only settable server-side, so it's safe to trust — unlike
// user_metadata, which the user can edit themselves via
// supabase.auth.updateUser()). If your project actually stores the
// admin flag differently (a separate `admins` table, a Postgres
// custom claim, user_metadata, etc.), update the `role` lookup below
// — nothing else in this file needs to change.
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

type RequireAdminResult =
  | { authorized: true; user: { id: string; email?: string } }
  | { authorized: false; status: 401 | 403; message: string };

export async function requireAdmin(): Promise<RequireAdminResult> {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // API routes only ever read the session here — never
        // refresh/write it — so setAll is intentionally a no-op.
        setAll() {},
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { authorized: false, status: 401, message: 'not signed in' };
  }

  const role = (user.app_metadata as Record<string, unknown> | null)?.role;
  if (role !== 'admin') {
    return { authorized: false, status: 403, message: 'admin role required' };
  }

  const { data: dbUser, error: dbUserError } = await supabase
  .from('users')
  .select('id, role, email, is_platform_admin')
  .eq('supabase_user_id', user.id)
  .single();

if (dbUserError || !dbUser) {
  return {
    authorized: false,
    status: 403,
    message: 'user profile not found'
  };
}

if (dbUser.role !== 'admin' && !dbUser.is_platform_admin) {
  return {
    authorized: false,
    status: 403,
    message: 'admin role required'
  };
}

return {
  authorized: true,
  user: {
    id: dbUser.id,
    email: dbUser.email
  }
};
}
