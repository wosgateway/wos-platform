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
// LOGO IMAGE SPEC (tell partners/whoever prepares the files):
//   - Format: PNG or SVG with a TRANSPARENT background (WebP with
//     alpha also works). Avoid JPG — it can't do transparency and
//     will show a white/colored box around the mark.
//   - Recommended canvas: 400×160px (5:2 landscape), logo mark
//     centered with a bit of breathing room — this matches the
//     display height below (each logo renders at a fixed 48px tall,
//     width auto) and looks sharp on retina screens without being a
//     huge file. A perfectly square or very tall logo still works;
//     the box just won't be as full.
//   - Keep file size small (< 200KB) — these load on every homepage
//     visit.
//   - Prefer each brand's official mark on a plain/transparent
//     background, not a screenshot with padding/shadow baked in —
//     inconsistent padding makes the row look uneven since every
//     logo is vertically centered at the same height.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';

interface LogoPartner {
  id: string;
  name: string;
  logo_url: string;
}

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

  // Duplicate the list so the CSS animation can scroll from 0% to
  // -50% and loop seamlessly — the second half is a visual copy of
  // the first, so the "seam" where it loops is invisible.
  const track = logos.length > 0 ? [...logos, ...logos] : [];

  return (
    <section className="border-y border-slate-100 bg-slate-50/60 py-8">
      <div className="mx-auto max-w-5xl px-4">
        <p className="text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
          {t('label')}
        </p>

        {loading ? (
          <div className="mt-5 flex justify-center gap-6">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 w-28 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="wos-logo-scroller relative mt-5 overflow-hidden">
            {/* Fade edges so logos don't appear to cut off abruptly */}
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-slate-50/60 to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-slate-50/60 to-transparent" />

            <div className="wos-logo-track flex w-max items-center gap-10">
              {track.map((p, i) => (
                <img
                  key={`${p.id}-${i}`}
                  src={p.logo_url}
                  alt={p.name}
                  title={p.name}
                  className="h-12 w-auto flex-shrink-0 object-contain opacity-70 transition-opacity hover:opacity-100"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Plain global keyframes (not styled-jsx scoping) — simplest
          way to add a one-off animation without touching
          tailwind.config. Class names are prefixed wos-* to avoid
          colliding with anything else on the page. */}
      <style>{`
        .wos-logo-track {
          animation: wos-logo-scroll 30s linear infinite;
        }
        .wos-logo-scroller:hover .wos-logo-track {
          animation-play-state: paused;
        }
        @keyframes wos-logo-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .wos-logo-track {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}
