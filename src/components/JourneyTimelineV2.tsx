'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * STEP 5 — Health Journey, redesigned presentation.
 *
 * Same 6 steps, same copy (Discover → Plan → Book → Travel → Care → Return),
 * pulled from the exact same `home.journey` translation keys as the current
 * JourneyTimeline.tsx — nothing in messages/*.json changes.
 *
 * What's new is purely presentational:
 *  - the route line "draws itself" in as the section scrolls into view
 *    (SVG stroke-dashoffset animation, normalized with pathLength so the
 *    same 0→100 logic works for the horizontal desktop line AND the
 *    vertical mobile line — no extra math, no extra deps)
 *  - each stop pops in with a short stagger so it reads as a sequence,
 *    not a grid
 *  - numbers are the dominant visual (typography-forward, matches the
 *    "route/border-crossing" concept from the brief) instead of only icons
 *
 * This is a parallel component — JourneyTimeline.tsx is untouched. Swap it
 * in on the homepage only after visual approval.
 */
export function JourneyTimelineV2() {
  const t = useTranslations('home.journey');
  const steps = t.raw('steps') as { icon: string; title: string; desc: string }[];

  const sectionRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;

    // Respect reduced-motion: reveal everything immediately, no draw animation.
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect(); // draw once, don't replay on every scroll pass
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="section-padding bg-primary-light/40">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">{t('title')}</h2>
          <p className="mt-2 text-slate-500">{t('subtitle')}</p>
        </div>

        <div className="relative mt-16">
          {/* ===== Desktop: horizontal route line ===== */}
          <svg
            className="pointer-events-none absolute left-0 top-6 hidden w-full md:block"
            style={{ height: 2 }}
            viewBox="0 0 1000 2"
            preserveAspectRatio="none"
            aria-hidden
          >
            <line
              x1="0"
              y1="1"
              x2="1000"
              y2="1"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="1 9"
              strokeLinecap="round"
              className="text-primary/25"
            />
            <line
              x1="0"
              y1="1"
              x2="1000"
              y2="1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="text-primary"
              pathLength={100}
              style={{
                strokeDasharray: 100,
                strokeDashoffset: inView ? 0 : 100,
                transition: 'stroke-dashoffset 1.4s cubic-bezier(0.65,0,0.35,1)',
              }}
            />
          </svg>

          {/* ===== Mobile: vertical route line ===== */}
          <svg
            className="pointer-events-none absolute left-6 top-0 block h-full w-[2px] md:hidden"
            viewBox="0 0 2 1000"
            preserveAspectRatio="none"
            aria-hidden
          >
            <line
              x1="1"
              y1="0"
              x2="1"
              y2="1000"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="1 9"
              strokeLinecap="round"
              className="text-primary/25"
            />
            <line
              x1="1"
              y1="0"
              x2="1"
              y2="1000"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="text-primary"
              pathLength={100}
              style={{
                strokeDasharray: 100,
                strokeDashoffset: inView ? 0 : 100,
                transition: 'stroke-dashoffset 1.4s cubic-bezier(0.65,0,0.35,1)',
              }}
            />
          </svg>

          <ol className="relative grid grid-cols-1 gap-y-10 md:grid-cols-6 md:gap-x-3 md:gap-y-0">
            {steps.map((step, i) => (
              <li
                key={step.title}
                className="relative flex items-start gap-4 text-left md:flex-col md:items-center md:gap-0 md:text-center"
                style={{
                  opacity: inView ? 1 : 0,
                  transform: inView ? 'translateY(0)' : 'translateY(10px)',
                  transition: `opacity 0.5s ease-out ${0.15 + i * 0.12}s, transform 0.5s ease-out ${
                    0.15 + i * 0.12
                  }s`,
                }}
              >
                {/* number-forward node: big numeral, icon as a small badge */}
                <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-white shadow-sm">
                  <span className="text-sm font-bold text-primary">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span
                    className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm shadow"
                    aria-hidden
                  >
                    {step.icon}
                  </span>
                </div>

                <div className="md:mt-4">
                  <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                  <p className="mt-1 max-w-[10rem] text-xs leading-relaxed text-slate-500 md:mx-auto">
                    {step.desc}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
