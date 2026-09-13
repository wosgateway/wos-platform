'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { HEALTH_GOAL_IMAGES } from '@/lib/healthGoals';

/**
 * HealthGoalFinder — "Find Your Health Goal" (Step 7).
 *
 * 4 tiles (Prevent / Restore / Renew / Optimize) that expand their image on
 * hover. "Explore" now links to `/?goal=<slug>#categories`, which the
 * Categories section on the homepage reads to filter itself down to the
 * matching categories (see HEALTH_GOAL_CATEGORY_MAP in lib/healthGoals.ts
 * and the searchParams handling in app/[locale]/page.tsx).
 *
 * New translation keys used: home.healthGoals.* (eyebrow, title, subtitle,
 * viewAllCta, exploreCta, items[].label, items[].desc) — added to
 * th/en/lo, nothing existing was changed.
 *
 * Hover vs. touch, kept fully separate:
 *  - Devices with a real mouse (`hover: hover` + `pointer: fine`) keep the
 *    original mouseenter/mouseleave zoom, exclusive to one tile at a time.
 *  - Everything else (touch) never fires mouseenter, and making the user
 *    tap-and-guess which tile is "open" is easy to miss with a thumb
 *    covering the screen. Instead each tile watches its own visibility via
 *    IntersectionObserver and zooms itself in as it scrolls into view —
 *    no tap required, and it un-zooms again if scrolled back out, so it
 *    stays accurate to what's actually on screen rather than firing once.
 */

interface HealthGoalItem {
  label: string;
  desc: string;
}

export function HealthGoalFinder({
  eyebrow,
  title,
  subtitle,
  viewAllCta,
  exploreCta,
  items,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  viewAllCta: string;
  exploreCta: string;
  items: HealthGoalItem[];
}) {
  // Desktop-only: which tile the mouse is currently over (exclusive).
  const [hovered, setHovered] = useState<number | null>(null);

  // Touch-only: which tiles are currently scrolled into view (not
  // exclusive — on a tall mobile grid more than one can be visible).
  const [inView, setInView] = useState<Set<number>>(new Set());

  // Decided once on mount: does this device have a real mouse? Checked via
  // matchMedia rather than a touch/no-touch sniff, since some laptops have
  // both a touchscreen and a mouse — `hover: hover` is the signal that
  // actually matters (can the pointer rest over something without a tap?).
  const [hasHover, setHasHover] = useState(true);

  useEffect(() => {
    const mql = window.matchMedia('(hover: hover) and (pointer: fine)');
    setHasHover(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setHasHover(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Widened from HTMLDivElement: tiles now render as <Link> (an <a>)
  // when there's an image to link to, and only fall back to a plain
  // <div> otherwise — HTMLElement is the common base both share, and
  // it's all IntersectionObserver/data-tile-index actually need.
  const tileRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    // Only needed on touch devices — desktop uses hover instead.
    if (hasHover) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setInView((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.tileIndex);
            if (entry.isIntersecting) {
              next.add(index);
            } else {
              next.delete(index);
            }
          }
          return next;
        });
      },
      // Trigger once a tile is roughly half-visible, so the effect reads
      // as "this one's in focus now" rather than firing at the first
      // sliver of a pixel entering the viewport.
      { threshold: 0.55 }
    );

    tileRefs.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [hasHover]);

  return (
    <section className="section-padding bg-white">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-gold-ink">
              {eyebrow}
            </span>
            <h2 className="mt-2 text-h2 text-navy">{title}</h2>
            <p className="mt-3 max-w-md text-sm text-slate-500">{subtitle}</p>
          </div>
          <a
            href="#categories"
            className="inline-flex w-fit items-center gap-1.5 rounded-full border border-navy/15 px-5 py-2 text-sm font-semibold text-navy transition-colors hover:bg-navy hover:text-white"
          >
            {viewAllCta}
            <span aria-hidden>→</span>
          </a>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, i) => {
            const img = HEALTH_GOAL_IMAGES[i];
            const isHovered = hasHover ? hovered === i : inView.has(i);
            // Whole tile is now the tap/click target (not just the small
            // "explore" text) — wrapped in Link instead of div. Falls back
            // to a plain div for the rare case there's no image/slug to
            // link to, so we never render a href-less anchor.
            const tileContent = (
              <>
                {img && (
                  <Image
                    src={img.image}
                    alt={img.alt}
                    fill
                    className={`object-cover transition-transform duration-500 ease-out ${
                      isHovered ? 'scale-110' : 'scale-100'
                    }`}
                    sizes="(max-width: 768px) 50vw, 25vw"
                  />
                )}
                <div
                  className={`absolute inset-0 bg-gradient-to-t from-navy-dark/90 via-navy-dark/30 to-transparent transition-opacity duration-300 ${
                    isHovered ? 'opacity-100' : 'opacity-90'
                  }`}
                />
                <div className="relative z-10 p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-white">
                    {item.label}
                  </p>
                  <p className="mt-1 text-sm text-white/80">{item.desc}</p>
                  {img && (
                    <span
                      className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold text-gold transition-all duration-300 max-sm:translate-y-0 max-sm:opacity-100 ${
                        isHovered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                      }`}
                    >
                      {exploreCta}
                      <span aria-hidden>→</span>
                    </span>
                  )}
                </div>
              </>
            );

            const tileClassName =
              'group relative flex h-72 flex-col justify-end overflow-hidden rounded-2xl border border-navy/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

            return img ? (
              <Link
                key={item.label}
                ref={(node) => {
                  tileRefs.current[i] = node;
                }}
                href={{ pathname: '/', query: { goal: img.slug }, hash: 'categories' }}
                data-tile-index={i}
                onMouseEnter={hasHover ? () => setHovered(i) : undefined}
                onMouseLeave={hasHover ? () => setHovered(null) : undefined}
                className={tileClassName}
              >
                {tileContent}
              </Link>
            ) : (
              <div
                key={item.label}
                ref={(node) => {
                  tileRefs.current[i] = node;
                }}
                data-tile-index={i}
                onMouseEnter={hasHover ? () => setHovered(i) : undefined}
                onMouseLeave={hasHover ? () => setHovered(null) : undefined}
                className={tileClassName}
              >
                {tileContent}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
