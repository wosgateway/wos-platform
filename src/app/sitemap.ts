import type { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';
import { routing } from '@/i18n/routing';
import { CATEGORIES } from '@/lib/categories';
import { KNOWLEDGE_ARTICLES } from '@/lib/knowledge';

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

// IMPORTANT: never throw here. If the env vars are missing or malformed,
// return null instead of crashing — a broken sitemap should never be able
// to fail the entire production build.
function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error(
      'sitemap: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing at build time — returning static-only sitemap'
    );
    return null;
  }

  return createClient(url, key);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = anonClient();

  let partners: { id: string | number }[] = [];
  let packages: { id: string | number }[] = [];

  // Only attempt the Supabase calls if the client was created successfully.
  if (supabase) {
    try {
      // Only select `id` — it's the one column guaranteed to exist on both
      // tables. (updated_at/created_at aren't in this project's schema, so
      // selecting them errors out the whole query instead of just omitting
      // a nice-to-have lastModified field.)
      const [partnersRes, packagesRes] = await Promise.all([
        supabase.from('partners').select('id').eq('status', 'active'),
        supabase
          .from('packages')
          .select('id, partners!inner(status)')
          .eq('status', 'published')
          .eq('is_active', true)
          .eq('partners.status', 'active'),
      ]);

      partners = partnersRes.data ?? [];
      packages = packagesRes.data ?? [];

      if (partnersRes.error) {
        console.error('sitemap: failed to load partners from Supabase', partnersRes.error.message);
      }
      if (packagesRes.error) {
        console.error('sitemap: failed to load packages from Supabase', packagesRes.error.message);
      }
    } catch (err) {
      // Belt-and-suspenders: any unexpected failure (network, malformed
      // response, etc.) falls back to the static-only sitemap instead of
      // taking down the whole build.
      console.error('sitemap: unexpected error querying Supabase', err);
    }
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

  // 3. Knowledge Center — listing page + each article, per locale
  for (const locale of LOCALES) {
    entries.push({
      url: `${SITE_URL}/${locale}/knowledge`,
      changeFrequency: 'monthly',
      priority: 0.5,
    });
    for (const article of KNOWLEDGE_ARTICLES) {
      entries.push({
        url: `${SITE_URL}/${locale}/knowledge/${article.slug}`,
        changeFrequency: 'monthly',
        priority: 0.5,
      });
    }
  }

  // 4. Partner detail pages — real IDs from Supabase, per locale
  for (const locale of LOCALES) {
    for (const partner of partners) {
      entries.push({
        url: `${SITE_URL}/${locale}/partner/${partner.id}`,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  }

  // 5. Program (package) detail pages — real IDs from Supabase, per locale
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
