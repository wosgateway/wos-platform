'use client';

import Image from 'next/image';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * WOSHealthJourney — Health Journey, photo-forward redesign (v4, reviewed).
 * Renamed from JourneyTimelineV2: this isn't a generic timeline anymore,
 * it's the WOS-specific route/gateway visual — update the import in
 * src/app/[locale]/page.tsx from `{ JourneyTimelineV2 }` /
 * `<JourneyTimelineV2 />` to `{ WOSHealthJourney }` / `<WOSHealthJourney />`
 * when swapping this file in, and rename the file itself on disk
 * (JourneyTimelineV2.tsx → WOSHealthJourney.tsx).
 *
 * Structural replacement of the numbered-icon layout: each step is now a
 * real photo inside a gold-ringed circle, laid out in an alternating
 * left/right zigzag down a center spine — at EVERY breakpoint (mobile uses
 * the same 3-column grid as desktop, just a narrower center column; it's
 * not a flat left-aligned list anymore). This reads better as a "route"
 * than the old horizontal 6-up row, and matches the WOS Health Journey
 * reference artwork. A "border crossing" marker sits between "Confirm
 * Booking" and "Travel to Thailand" since that's the actual Laos →
 * Thailand hand-off in the journey.
 *
 * Post-review fixes (v3 → this pass):
 *  - the flowing dash used to carry both a CSS `transition` and a CSS
 *    `animation` on the same `stroke-dashoffset` property — the animation
 *    would cut the transition off mid-flight. Now the flow is a plain
 *    Tailwind `animate-[...]` class and only `opacity` transitions.
 *  - the border-crossing `<li>` had `aria-hidden` on the whole element,
 *    which hid its "Border Crossing · Laos → Thailand" text label from
 *    screen readers, not just the decorative ✈️. `aria-hidden` now sits
 *    only on the emoji.
 *  - the SVG spine's `viewBox="0 0 3 1000"` looks hardcoded but isn't a
 *    real constraint: `preserveAspectRatio="none"` + `h-full` stretch it
 *    to whatever the actual rendered height is, so longer Thai/English
 *    copy doesn't break it.
 *
 * Photos: only 5 of the 6 `home.journey.steps` have a commissioned photo
 * right now (see STEP_PHOTOS below). "Confirm Booking" (index 2) has no
 * photo yet, so it falls back to its ✅ emoji on a plain gold-ring circle
 * — same treatment as the photo steps, just no image. Swap in a photo by
 * adding `2: '/images/journey/03-confirm-booking.jpg'` once one exists;
 * nothing else needs to change.
 *
 * Image priority: `StepNode` accepts an optional `priority` prop (default
 * `false`) but nothing in this file sets it — `page.tsx` renders
 * `<HeroV2 images={[{ src: '/images/hero/hero-1.webp', ... }]} />` first,
 * then `<PartnerLogos />`, then this section. Hero's own image is already
 * the LCP candidate; marking this section's first photo `priority` too
 * would make it compete with Hero for early bandwidth rather than help
 * perceived speed. If this section ever moves above Hero, or Hero drops
 * its own priority image, pass `priority` down from the caller then.
 *
 * Image files: this component expects the 5 photos at
 *   public/images/journey/01-get-in-touch.jpg
 *   public/images/journey/02-choose-program.jpg
 *   public/images/journey/04-travel-to-thailand.jpg
 *   public/images/journey/05-receive-care.jpg
 *   public/images/journey/06-travel-home.jpg
 * (delivered alongside this file — copy them into public/images/journey/).
 *
 * Motion: the center line now has two layers — a faint static track, and a
 * short dash that flows continuously along it on a loop (not just a single
 * draw-in) once the section scrolls into view, per the request to have the
 * line "run along the photos, looping." Disabled entirely under
 * prefers-reduced-motion, which instead gets the static track only.
 *
 * Dock magnify: every node circle (step photos + the border-crossing
 * marker) scales up smoothly based on distance from a "focus point",
 * exactly like macOS Dock magnification — not a hard hover on/off, a
 * continuous falloff.
 *   - Desktop (real mouse): the focus point follows the cursor's Y
 *     position while it's over the section, so whichever node the mouse
 *     is nearest grows the most.
 *   - Any device, while scrolling: the focus point is the vertical center
 *     of the viewport, so whichever node is currently scrolling past the
 *     middle of the screen grows — this is what gives touch devices the
 *     same effect without a mouse at all.
 * Mouse presence always wins over the scroll-center point while active;
 * scroll resumes driving the effect once the mouse leaves the section.
 * The math runs in a rAF loop and writes `transform` straight to the DOM
 * (bypassing React state) so it stays smooth during fast scrolling.
 * Skipped entirely under prefers-reduced-motion, same as the flow line.
 *
 * This is a parallel component — JourneyTimeline.tsx (the original) is
 * untouched. Swap it in on the homepage only after visual approval.
 *
 * Journey video (added): a click-to-play card sits above the timeline,
 * under the title/subtitle. Poster image shown until the user taps play
 * (no autoplay, no loop) — the clip has a narrative beat (phone → lobby →
 * WOSA logo), not an ambient loop, so autoplaying it as a background would
 * "reset" visibly every 10s. Click-to-play also avoids costing mobile
 * users on the Laos-Thailand corridor any data until they actively want it.
 * Expects files at:
 *   public/videos/wos-journey.mp4
 *   public/videos/wos-journey.webm
 *   public/images/journey/journey-poster.jpg
 * IMPORTANT: the source clip is AI-generated and carries a small
 * provenance watermark (bottom-right) from the generation tool — it was
 * intentionally left in place rather than removed, since stripping a
 * synthetic-media watermark from a clip used to depict a patient journey
 * would misrepresent it as real footage. `videoDisclaimer` renders as a
 * visible caption under the card for the same reason; don't remove it
 * without replacing the clip with real footage first.
 */

// Dock-magnify tuning: how much bigger the closest node gets, and how
// quickly the effect falls off with distance (px) from the focus point.
const MAGNIFY_MAX_SCALE = 1.3;
const MAGNIFY_FALLOFF_RADIUS = 130;

// Maps a `home.journey.steps` index (0-based) to a real photo. Step 2
// ("Confirm Booking") intentionally has no entry — see file header.
const STEP_PHOTOS: Record<number, string> = {
  0: '/images/journey/01-get-in-touch.jpg',
  1: '/images/journey/02-choose-program.jpg',
  3: '/images/journey/04-travel-to-thailand.jpg',
  4: '/images/journey/05-receive-care.jpg',
  5: '/images/journey/06-travel-home.jpg',
};

// Step index the "border crossing" marker is inserted BEFORE.
const BORDER_CROSSING_BEFORE_INDEX = 3; // i.e. right before "Travel to Thailand"

interface JourneyStep {
  icon: string;
  title: string;
  desc: string;
}

export function WOSHealthJourney() {
  const t = useTranslations('home.journey');
  const steps = t.raw('steps') as JourneyStep[];

  const sectionRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  // Every node circle registers itself here (cleared and rebuilt on each
  // render, populated by the ref callbacks below) so the magnify effect
  // can loop over "all the circles" without caring how many steps there
  // are or where the border-crossing marker falls among them.
  const magnifyRefs = useRef<HTMLElement[]>([]);
  magnifyRefs.current = [];
  const registerMagnifyNode = (el: HTMLElement | null) => {
    if (el) magnifyRefs.current.push(el);
  };

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReducedMotion(prefersReducedMotion);
    if (prefersReducedMotion) {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect(); // trigger once; the flow animation itself loops forever after
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Dock-style magnify: see file header. Kept out of React state on
  // purpose — writing `transform` directly to each node's DOM element
  // every animation frame is what keeps this smooth while scrolling fast,
  // where a setState-per-frame approach would visibly lag.
  useEffect(() => {
    if (reducedMotion) return;
    const section = sectionRef.current;
    if (!section) return;

    const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    let hasHoverDevice = hoverQuery.matches;
    const onHoverChange = (e: MediaQueryListEvent) => {
      hasHoverDevice = e.matches;
    };
    hoverQuery.addEventListener('change', onHoverChange);

    let focusY: number | null = null;
    let mouseActive = false;
    let rafId: number | null = null;

    const applyMagnify = () => {
      rafId = null;
      for (const node of magnifyRefs.current) {
        if (focusY == null) {
          node.style.transform = 'scale(1)';
          continue;
        }
        const rect = node.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const distance = Math.abs(center - focusY);
        const scale =
          1 +
          (MAGNIFY_MAX_SCALE - 1) *
            Math.exp(-(distance * distance) / (2 * MAGNIFY_FALLOFF_RADIUS * MAGNIFY_FALLOFF_RADIUS));
        node.style.transform = `scale(${scale.toFixed(3)})`;
      }
    };

    const scheduleUpdate = () => {
      if (rafId == null) rafId = requestAnimationFrame(applyMagnify);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!hasHoverDevice) return;
      mouseActive = true;
      focusY = e.clientY;
      scheduleUpdate();
    };

    const onMouseLeave = () => {
      mouseActive = false;
      // Hand focus back to whatever the current scroll position implies,
      // rather than snapping straight to "nothing magnified".
      focusY = window.innerHeight / 2;
      scheduleUpdate();
    };

    const onScroll = () => {
      if (mouseActive) return; // the cursor takes priority while it's active
      focusY = window.innerHeight / 2;
      scheduleUpdate();
    };

    section.addEventListener('mousemove', onMouseMove);
    section.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // set an initial state immediately, don't wait for the first scroll/move

    return () => {
      hoverQuery.removeEventListener('change', onHoverChange);
      section.removeEventListener('mousemove', onMouseMove);
      section.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('scroll', onScroll);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [reducedMotion]);

  return (
    <section ref={sectionRef} className="section-padding bg-primary-light/40">
      <style>{`
        @keyframes wos-path-flow {
          to { stroke-dashoffset: -48; }
        }
        @keyframes wos-node-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(201, 151, 74, 0.45); }
          50% { box-shadow: 0 0 0 10px rgba(201, 151, 74, 0); }
        }
      `}</style>
      <div className="mx-auto max-w-4xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">{t('title')}</h2>
          <p className="mt-2 text-slate-500">{t('subtitle')}</p>
        </div>

        {/* Journey video card — click-to-play, no autoplay/loop (see file
            header re: this being a narrative clip, not an ambient loop). */}
        <div className="mx-auto mt-10 max-w-2xl">
          <div className="relative aspect-video overflow-hidden rounded-3xl bg-slate-900 shadow-lg">
            {videoPlaying ? (
              <video
                className="h-full w-full object-cover"
                controls
                autoPlay
                playsInline
                poster="/images/journey/journey-poster.jpg"
              >
                <source src="/videos/wos-journey.webm" type="video/webm" />
                <source src="/videos/wos-journey.mp4" type="video/mp4" />
              </video>
            ) : (
              <button
                type="button"
                onClick={() => setVideoPlaying(true)}
                className="group relative block h-full w-full"
                aria-label={t('videoPlay')}
              >
                <Image
                  src="/images/journey/journey-poster.jpg"
                  alt=""
                  fill
                  sizes="(min-width: 768px) 672px, 100vw"
                  className="object-cover"
                />
                <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/30" />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 shadow-lg transition-transform group-hover:scale-105 md:h-20 md:w-20">
                    <svg
                      viewBox="0 0 24 24"
                      className="ml-1 h-7 w-7 text-primary md:h-8 md:w-8"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-xs text-slate-400">{t('videoDisclaimer')}</p>
        </div>

        <ol className="relative mt-16 flex flex-col gap-14 md:gap-20">
          {/* ===== Center spine: static track + continuously looping flow dash =====
              viewBox height (1000) is an arbitrary coordinate space, not a pixel
              length — preserveAspectRatio="none" + h-full stretch it to whatever
              the real rendered height is, so longer Thai/English copy doesn't
              break it; nothing to hardcode-fix here. */}
          <svg
            className="pointer-events-none absolute left-1/2 top-0 z-0 h-full w-[3px] -translate-x-1/2"
            preserveAspectRatio="none"
            viewBox="0 0 3 1000"
            aria-hidden
          >
            <line
              x1="1.5"
              y1="0"
              x2="1.5"
              y2="1000"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className="text-primary/20"
            />
            <line
              x1="1.5"
              y1="0"
              x2="1.5"
              y2="1000"
              stroke="#C9974A"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="10 14"
              className={
                inView && !reducedMotion ? 'animate-[wos-path-flow_1.8s_linear_infinite]' : ''
              }
              style={{
                opacity: inView ? 1 : 0,
                transition: 'opacity 0.6s ease-out',
              }}
            />
          </svg>

          {steps.map((step, i) => (
            <Fragment key={step.title}>
              {i === BORDER_CROSSING_BEFORE_INDEX && (
                <li className="relative flex flex-col items-center gap-2 py-1 text-center">
                  <span
                    ref={registerMagnifyNode}
                    className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 border-primary/30 bg-white text-lg shadow-sm transition-transform duration-150 ease-out will-change-transform"
                    aria-hidden
                  >
                    ✈️
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
                    Cross-Border Healthcare Gateway
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">
                    Laos → Thailand
                  </span>
                </li>
              )}

              <li
                className="relative grid grid-cols-[1fr_4.5rem_1fr] items-center gap-x-3 md:grid-cols-[1fr_7.5rem_1fr] md:gap-x-6"
                style={{
                  opacity: inView ? 1 : 0,
                  transform: inView ? 'translateY(0)' : 'translateY(10px)',
                  transition: `opacity 0.5s ease-out ${0.12 + i * 0.1}s, transform 0.5s ease-out ${
                    0.12 + i * 0.1
                  }s`,
                }}
              >
                {/* Text — left of spine on even steps, right on odd, at every breakpoint */}
                <div
                  className={
                    i % 2 === 0 ? 'order-1 col-start-1 text-right' : 'order-3 col-start-3 text-left'
                  }
                >
                  <StepText step={step} index={i} />
                </div>

                {/* Node — always the center column, both breakpoints */}
                <div
                  ref={registerMagnifyNode}
                  className="relative z-10 order-2 col-start-2 mx-auto shrink-0 transition-transform duration-150 ease-out will-change-transform"
                >
                  <StepNode
                    step={step}
                    index={i}
                    photo={STEP_PHOTOS[i]}
                    inView={inView}
                    reducedMotion={reducedMotion}
                  />
                </div>

                {/* Empty spacer on the side with no text this row, so the grid stays 3 columns */}
                <div className={i % 2 === 0 ? 'order-3 col-start-3' : 'order-1 col-start-1'} />
              </li>
            </Fragment>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StepNode({
  step,
  index,
  photo,
  inView,
  reducedMotion,
  priority = false,
}: {
  step: JourneyStep;
  index: number;
  photo?: string;
  inView: boolean;
  reducedMotion: boolean;
  /** Defaults to false on purpose — see file header re: Hero already owns priority. */
  priority?: boolean;
}) {
  return (
    <div className="relative h-20 w-20 md:h-28 md:w-28">
      {/* gold ring — a short two-pulse glow fires once per node, timed just
          after its own fade-in, so it reads as "the line reaching this
          stop" rather than a permanent animate-pulse (which every step
          running forever, out of sync with each other, would just look
          like a broken loading state on a healthcare site). */}
      <div
        className="absolute inset-0 rounded-full bg-gradient-to-br from-[#C9974A] to-[#A97A2E] p-[3px] shadow-lg"
        style={{
          animation:
            inView && !reducedMotion
              ? `wos-node-glow 1.2s ease-out ${0.7 + index * 0.45}s 2`
              : undefined,
        }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-full bg-white">
          {photo ? (
            <Image
              src={photo}
              alt={step.title}
              fill
              sizes="(min-width: 768px) 112px, 80px"
              className="object-cover"
              priority={priority}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-light to-white text-3xl text-primary md:text-4xl">
              {step.icon}
            </div>
          )}
        </div>
      </div>

      {/* number badge */}
      <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white shadow ring-2 ring-white md:-bottom-1.5 md:-right-1.5 md:h-8 md:w-8 md:text-xs">
        {String(index + 1).padStart(2, '0')}
      </span>

      {/* small icon badge — only when the circle itself is a photo, so the
          emoji doesn't get lost (it's already the whole circle otherwise) */}
      {photo && (
        <span className="absolute -top-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs shadow ring-1 ring-primary/15 md:-top-1.5 md:-left-1.5 md:h-7 md:w-7 md:text-sm">
          {step.icon}
        </span>
      )}
    </div>
  );
}

function StepText({ step, index }: { step: JourneyStep; index: number }) {
  return (
    <div className="md:mt-0">
      <p className="text-xs font-bold uppercase tracking-widest text-[#C9974A]">
        {String(index + 1).padStart(2, '0')}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-900 md:text-lg">{step.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-slate-500 md:max-w-xs">{step.desc}</p>
    </div>
  );
}
