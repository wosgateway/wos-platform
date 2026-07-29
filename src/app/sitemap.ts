import type { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';
import { routing } from '@/i18n/routing';
import { CATEGORIES } from '@/lib/categories';

// Dynamic sitemap replacing the old static public/sitemap.xml.
// Next.js serves this at /sitemap.xml automatically (App Router convention:
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap).
//
// It queries Supabase directly (same anon key/RLS as the public pages — only
// active partners/packages are readable) rather than going through the
// request-scoped server client, since a sitemap has no incoming cookies.
//
// Revalidates hourly so new partners/packages show up without a redeploy.
export const revalidate = 3600;

const SITE_URL = 'https://wos.asia';
const LOCALES = routing.locales;

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = anonClient();

  // Only select `id` — it's the one column guaranteed to exist on both
  // tables. (updated_at/created_at aren't in this project's schema, so
  // selecting them errors out the whole query instead of just omitting
  // a nice-to-have lastModified field.)
  const [partnersRes, packagesRes] = await Promise.all([
    supabase.from('partners').select('id').eq('status', 'active'),
    supabase.from('packages').select('id, partners!inner(status)').eq('partners.status', 'active'),
  ]);

  const partners = partnersRes.data ?? [];
  const packages = packagesRes.data ?? [];

  if (partnersRes.error) {
    console.error('sitemap: failed to load partners from Supabase', partnersRes.error.message);
  }
  if (packagesRes.error) {
    console.error('sitemap: failed to load packages from Supabase', packagesRes.error.message);
  }

  const entries: MetadataRoute.Sitemap = [];

  // 1. Home page per locale
  for (const locale of LOCALES) {
    entries.push({
      url: `${SITE_URL}/${locale}`,
      changeFrequency: 'weekly',
      priority: 1.0,
    });
  }

  // 2. Category listing pages per locale
  for (const locale of LOCALES) {
    for (const category of CATEGORIES) {
      entries.push({
        url: `${SITE_URL}/${locale}/category/${category.slug}`,
        changeFrequency: 'weekly',
        priority: 0.8,
      });
    }
  }

  // 3. Partner detail pages — real IDs from Supabase, per locale
  for (const locale of LOCALES) {
    for (const partner of partners) {
      entries.push({
        url: `${SITE_URL}/${locale}/partner/${partner.id}`,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  }

  // 4. Program (package) detail pages — real IDs from Supabase, per locale
  for (const locale of LOCALES) {
    for (const pkg of packages) {
      entries.push({
        url: `${SITE_URL}/${locale}/program/${pkg.id}`,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
  }

  return entries;
}
