'use client';

// src/components/PartnerLogos.tsx
//
// Homepage "Trusted by" scrolling logo strip. UPDATED: previously a
// text-only placeholder pulling names from src/messages/*.json
// (home.partners.names) — not real logos, not connected to the
// partners table. Now pulls real logo images from
// partners.logo_url where partners.show_on_homepage = true, so an
// admin can add/remove a logo from PartnersManager.tsx without any
// code change (see migration 023).
//
// UPDATED AGAIN: the strip now auto-scrolls continuously (a CSS
// "marquee" loop) instead of requiring the user to click arrows.
// The logo list is duplicated so the loop is seamless, it pauses on
// hover, and it respects prefers-reduced-motion for accessibility.
//
// LOGO IMAGE SPEC (tell partners/whoever prepares the files):
//   - Format: PNG or SVG with a TRANSPARENT background (WebP with
//     alpha also works). Avoid JPG — it can't do transparency and
//     will show a white/colored box around the mark.
//   - Recommended canvas: 320×320px (square), logo mark centered
//     with breathing room — each logo now renders inside a fixed
//     square card (128px mobile / 160px desktop, object-contain
//     with padding), so a square source avoids the mark looking
//     off-center inside the card. A wide/landscape logo still
//     works; it'll just sit smaller within the square.
//   - Keep file size small (< 200KB) — these load on every homepage
//     visit.
//   - Prefer each brand's official mark on a plain/transparent
//     background, not a screenshot with padding/shadow baked in —
//     inconsistent padding makes the row look uneven since every
//     card is the same fixed size.

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';

interface LogoPartner {
  id: string;
  name: string;
  logo_url: string;
}

// How long one full loop takes, scaled by how many logos there are so
// the perceived speed (px/sec) stays roughly constant regardless of
// list length. Feel free to tweak SECONDS_PER_LOGO to speed up/slow
// down the "ค่อยๆเลื่อน" pace.
const SECONDS_PER_LOGO = 4;
const MIN_LOOP_SECONDS = 20;

export function PartnerLogos() {
  const t = useTranslations('home.partners');
  const [logos, setLogos] = useState<LogoPartner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('partners')
        .select('id, name, logo_url')
        .eq('show_on_homepage', true)
        .eq('status', 'active')
        .not('logo_url', 'is', null)
        .order('name');
      setLogos((data ?? []) as LogoPartner[]);
      setLoading(false);
    }
    load();
  }, []);

  // Nothing to show yet (no partner opted in) — hide the whole
  // section rather than showing an empty/broken-looking strip.
  if (!loading && logos.length === 0) return null;

  // Duplicate the list so the strip can loop seamlessly. Short lists
  // get duplicated more times so there's always enough width to
  // scroll through before the loop resets (translateX(-50%) below
  // always lands exactly on a repeat-boundary either way).
  const repeats = logos.length >= 8 ? 2 : 4;
  const loop = Array.from({ length: repeats }, () => logos).flat();
  const loopSeconds = Math.max(logos.length * SECONDS_PER_LOGO, MIN_LOOP_SECONDS);

  return (
    <section className="border-y border-slate-100 bg-slate-50/60 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl px-4">
        <p className="text-sm font-semibold uppercase tracking-wider text-slate-400 sm:text-base">
          {t('label')}
        </p>

        {loading ? (
          <div className="mt-6 flex gap-4 overflow-hidden">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-32 w-32 flex-shrink-0 animate-pulse rounded-2xl bg-slate-100 sm:h-40 sm:w-40" />
            ))}
          </div>
        ) : (
          <div className="group relative mt-6 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
            <div className="marquee-track flex w-max gap-4 pb-2">
              {loop.map((p, i) => (
                <div
                  key={`${p.id}-${i}`}
                  className="flex w-32 flex-shrink-0 flex-col items-center gap-2 sm:w-40"
                >
                  <div className="relative flex h-32 w-32 items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md sm:h-40 sm:w-40">
                    <Image
                      src={p.logo_url}
                      alt={p.name}
                      title={p.name}
                      fill
                      sizes="(max-width: 639px) 128px, 160px"
                      className="object-contain p-4"
                    />
                  </div>
                  <span className="line-clamp-2 text-center text-xs font-medium text-slate-600 sm:text-sm">
                    {p.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .marquee-track {
          animation: partner-logos-marquee ${loopSeconds}s linear infinite;
        }
        .group:hover .marquee-track {
          animation-play-state: paused;
        }
        @keyframes partner-logos-marquee {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}
