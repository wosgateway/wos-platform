'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * STEP 11 — count-up motion on the trust stats.
 *
 * Each `value` string (e.g. "1,000+", "24 ชม.") is split into a leading
 * numeric part and a trailing suffix. Only the numeric part animates from 0
 * up to its target when the bar scrolls into view; the suffix (+, " ชม.",
 * " ประเทศ", etc.) renders as-is so this works for every locale without
 * needing separate numeric/label translation keys.
 *
 * Values with no leading number (rare, but don't assume it can't happen)
 * just render statically — no animation, no crash.
 */

function parseValue(raw: string): { target: number | null; prefix: string; suffix: string } {
  const match = raw.match(/^(\D*)([\d,]+)(.*)$/);
  // No leading number: `display` already holds the full raw string (see
  // CountUpValue's useState init below), so suffix must be empty here —
  // otherwise it renders as prefix + raw + raw, duplicating the text.
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
  const ref = useRef<HTMLParagraphElement>(null);
  const [display, setDisplay] = useState(target === null ? raw : '0');

  useEffect(() => {
    if (target === null) return;
    const node = ref.current;
    if (!node || target === null) return;

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
          // ease-out cubic — starts fast, settles gently instead of a linear tick-up
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
    <p ref={ref} className="text-3xl font-bold leading-none text-gold md:text-4xl">
      {prefix}
      {display}
      {suffix}
    </p>
  );
}

export function TrustBar({
  align = 'center',
  partnerCount,
}: {
  align?: 'center' | 'left';
  // Live count of active partners (see fetchActivePartnerCount in
  // src/lib/data.ts), passed down from a server component. One item's
  // translation value carries a "{count}+ " template prefix (see
  // th/en/lo.json home.trustBar.items) — we substitute the real number
  // in here so CountUpValue's existing leading-number parsing/animation
  // just works, no changes needed there. If the count couldn't be
  // fetched (partnerCount is undefined), we strip the "{count}+ "
  // prefix instead of rendering the literal placeholder, falling back
  // to the plain noun that used to be hardcoded here.
  partnerCount?: number;
}) {
  const t = useTranslations('home.trustBar');
  const rawItems = t.raw('items') as { value: string; label: string }[];
  const items = rawItems.map((item) => ({
    ...item,
    value:
      typeof partnerCount === 'number'
        ? item.value.replace('{count}', String(partnerCount))
        : item.value.replace('{count}+ ', ''),
  }));
  const isLeft = align === 'left';

  return (
    <div className="mt-10">
      {/* eyebrow headline — WOS.os style: small caps, letter-spaced, gold accent */}
      <p
        className={`text-[11px] font-semibold uppercase tracking-[0.2em] text-gold md:text-xs ${isLeft ? 'text-left' : 'text-center'}`}
      >
        {t('headline')}
      </p>

      <div
        className={`mt-4 flex flex-wrap items-center gap-3 ${isLeft ? 'justify-start' : 'justify-center'}`}
      >
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-white/10 bg-navy-dark/80 px-5 py-3.5 text-center backdrop-blur-md sm:px-7"
          >
            <CountUpValue raw={item.value} />
            <p className="mt-1.5 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-white/70 md:text-[11px]">
              {item.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
