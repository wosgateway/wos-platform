'use client';

import { useState } from 'react';
import Image from 'next/image';
import { HEALTH_GOAL_IMAGES } from '@/lib/healthGoals';

/**
 * HealthGoalFinder — "Find Your Health Goal" (Step 7).
 *
 * 4 tiles (Prevent / Restore / Renew / Optimize) that expand their image on
 * hover. Per the step plan this is presentation-only for now: clicking
 * "Explore" does NOT filter the Programs section yet — that wiring is a
 * separate, later step once this layout is approved. The onExplore prop
 * is a no-op stub today; swap it for real filter logic without touching
 * the markup when that's ready.
 *
 * New translation keys used: home.healthGoals.* (eyebrow, title, subtitle,
 * viewAllCta, exploreCta, items[].label, items[].desc) — added to
 * th/en/lo, nothing existing was changed.
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
  const [hovered, setHovered] = useState<number | null>(null);

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
            const isHovered = hovered === i;
            return (
              <div
                key={item.label}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className="group relative flex h-72 flex-col justify-end overflow-hidden rounded-2xl border border-navy/10"
              >
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
                  <button
                    type="button"
                    className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold text-gold transition-all duration-300 ${
                      isHovered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                    }`}
                  >
                    {exploreCta}
                    <span aria-hidden>→</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
