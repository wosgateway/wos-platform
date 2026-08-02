// src/lib/supabase/service.ts
//
// Service-role client — bypasses RLS entirely. Only ever import this
// inside server-only code (route handlers, server actions). Never import
// it into a 'use client' file or anything that could end up in a client
// bundle — the key has full read/write access to every table.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase Dashboard →
// Settings → API → service_role secret). Do NOT prefix it with
// NEXT_PUBLIC_ — that would ship it to the browser.

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — service client cannot be created.'
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
