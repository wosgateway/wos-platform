'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheck, Clock } from 'lucide-react';

/**
 * STEP 12 — single-row redesign (2026-09), replacing the "· " separated
 * strip from Step 11.
 *
 * Design brief: one unbroken row under the CTAs — verified-partner count,
 * the Thailand–Laos flag pair, and 24h support — each with a small icon,
 * separated by vertical rules instead of the old middle-dot strip. Never
 * wraps to a second line; on a viewport too narrow to fit all three it
 * scrolls horizontally instead (see `.no-scrollbar` below), so the row
 * never reads as an accidental paragraph break.
 *
 * Source data is unchanged: home.trustBar.items in th/en/lo.json, same
 * four-item shape as before ([0] coordinated journeys, [1] verified
 * partners, [2] 24h support, [3] countries). This row only surfaces
 * items 1, 3, 2 — item 0 ("coordinated patient journeys") has no natural
 * icon and is dropped from display without touching the translation data,
 * in case a future layout wants it back.
 *
 * Count-up motion on the numeric part of each value is unchanged from
 * Step 11 — see parseValue/CountUpValue.
 *
 * STEP 13 — review fixes (2026-09):
 *  1. The `{count}` fallback strip was a literal `.replace('{count}+ ', '')`,
 *     hard-coded to English's "{count}+ " spacing. Swapped for a regex
 *     that matches the "{count}" placeholder plus an optional "+" and
 *     any trailing whitespace, globally, so it isn't coupled to one
 *     locale's exact punctuation/spacing.
 *  2. Item 3 (countries) used to render as "2 countries Thailand–Laos"
 *     (value + label both shown) — a leftover statistic framing that
 *     didn't match its own label. Since this item is a brand statement,
 *     not a count, "Thailand–Laos" (ไทย–ลาว / ໄທ–ລາວ) now IS the value —
 *     see home.trustBar.items[3] in th/en/lo.json — and label is empty.
 *     Render below skips the label span (and its leading space) when
 *     label is empty, instead of leaving a stray trailing space.
 *  3. `key={item.label}` broke once the countries item's label went
 *     empty (any future empty-label item would collide with it). ROW
 *     is a static config array, so `key={i}` (its own map index) is a
 *     safe, stable key — switched to that instead.
 */

function parseValue(raw: string): { target: number | null; prefix: string; suffix: string } {
  const match = raw.match(/^(\D*)([\d,]+)(.*)$/);
  if (!match) return { target: null, prefix: '', suffix: '' };
  const [, prefix, digits, suffix] = match;
  const target = Number(digits.replace(/,/g, ''));
  if (Number.isNaN(target)) return { target: null, prefix: '', suffix: '' };
  return { target, prefix, suffix };
}

function formatWithCommas(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function CountUpValue({ raw }: { raw: string }) {
  const { target, prefix, suffix } = parseValue(raw);
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(target === null ? raw : '0');

  useEffect(() => {
    if (target === null) return;
    const node = ref.current;
    if (!node) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setDisplay(formatWithCommas(target));
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        const duration = 1200;
        const start = performance.now();

        function tick(now: number) {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          if (target !== null) {
            setDisplay(formatWithCommas(target * eased));
          }
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [target]);

  return (
    <span ref={ref} className="font-bold text-white">
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

/** Small flag pair for the "Thailand–Laos" item — inline SVG so it needs no
 * image asset and stays crisp at 20×14. */
function ThLaFlagPair() {
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
      <svg viewBox="0 0 30 20" className="h-3.5 w-5 rounded-[2px] shadow-[0_0_0_1px_rgba(255,255,255,0.3)]">
        <rect width="30" height="20" fill="#FFFFFF" />
        <rect width="30" height="3.33" y="0" fill="#EF2B3B" />
        <rect width="30" height="6.67" y="6.67" fill="#2942B5" />
        <rect width="30" height="3.33" y="16.67" fill="#EF2B3B" />
      </svg>
      <svg viewBox="0 0 30 20" className="h-3.5 w-5 rounded-[2px] shadow-[0_0_0_1px_rgba(255,255,255,0.3)]">
        <rect width="30" height="20" fill="#0B5AC4" />
        <rect width="30" height="5" y="0" fill="#EF2B3B" />
        <rect width="30" height="5" y="15" fill="#EF2B3B" />
        <circle cx="15" cy="10" r="3.6" fill="#FFFFFF" />
      </svg>
    </span>
  );
}

// Which of the four home.trustBar.items entries to show, in display order,
// and the icon each one gets. Index 0 (coordinated journeys) is skipped.
const ROW: { index: number; icon: 'shield' | 'flags' | 'clock' }[] = [
  { index: 1, icon: 'shield' },
  { index: 3, icon: 'flags' },
  { index: 2, icon: 'clock' },
];

export function TrustBar({
  align = 'center',
  partnerCount,
}: {
  align?: 'center' | 'left';
  // Live count of active partners (see fetchActivePartnerCount in
  // src/lib/data.ts). One item's translation value carries a "{count}"
  // placeholder (see th/en/lo.json home.trustBar.items). We substitute
  // the live partner count here so CountUpValue can parse and animate
  // the numeric value. If the count couldn't be fetched (partnerCount
  // is undefined), we remove the "{count}" placeholder and any optional
  // "+" / whitespace so the UI never exposes a raw template token.
  partnerCount?: number;
}) {
  const t = useTranslations('home.trustBar');
  const rawItems = t.raw('items') as { value: string; label: string }[];
  const items = rawItems.map((item) => ({
    ...item,
    value:
      typeof partnerCount === 'number'
        ? item.value.replace('{count}', String(partnerCount))
        : item.value.replace(/\{count\}\+?\s*/g, ''),
  }));

  return (
    <div className={`mt-10 border-t border-white/15 pt-[22px] ${align === 'left' ? '' : 'flex justify-center'}`}>
      {/* scrollbarWidth hides it in Firefox; the <style> tag hides it in
          Chrome/Safari. Only kicks in if the viewport is too narrow to fit
          all three items — otherwise there's nothing to scroll. */}
      <style>{`.wos-trust-row::-webkit-scrollbar { display: none; }`}</style>
      <div
        className="wos-trust-row flex items-center overflow-x-auto text-sm text-white/70"
        style={{ scrollbarWidth: 'none' }}
      >
        {ROW.map(({ index, icon }, i) => {
          const item = items[index];
          if (!item) return null;
          return (
            <span
              key={i}
              className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap ${
                i < ROW.length - 1 ? 'mr-[22px] border-r border-white/15 pr-[22px]' : ''
              }`}
            >
              {icon === 'shield' && <ShieldCheck className="h-[17px] w-[17px] shrink-0 text-gold" aria-hidden="true" />}
              {icon === 'flags' && <ThLaFlagPair />}
              {icon === 'clock' && <Clock className="h-[17px] w-[17px] shrink-0 text-gold" aria-hidden="true" />}
              <span className="whitespace-nowrap">
                <CountUpValue raw={item.value} />
                {/* Countries item (flags icon) has no label — "Thailand–Laos"
                    now lives entirely in `value` so it renders bold/white
                    via CountUpValue instead of duplicating as "2 countries
                    Thailand–Laos". Only render the label span (and its
                    leading space) when there's actually a label. */}
                {item.label && <> <span className="text-white/70">{item.label}</span></>}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
