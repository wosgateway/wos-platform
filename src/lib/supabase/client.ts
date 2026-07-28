import { createBrowserClient } from '@supabase/ssr';

/**
 * Client-side Supabase instance.
 * Replaces the old window.__supabase pattern from js/main.js —
 * every page used to re-declare SUPABASE_URL/ANON_KEY; now it's one
 * source of truth reading from env vars instead of being hardcoded.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
