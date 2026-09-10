'use client';

// src/components/PromoBannerSlider.tsx
//
// Homepage promo banner carousel — full-bleed hero-style slider, placed
// right under HeroV2 (see page.tsx). Modeled on hdmall.co.th's top banner:
// wide/short image, overlay arrow buttons, dot indicators, no padding
// around the image itself.
//
// Wired to real data: page.tsx (server component) calls
// fetchActivePromoBanners() from lib/data.ts and passes the result in as
// `banners`, mapped from the promo_banners row shape to PromoBanner below.
// Content is managed in /admin via PromoBannersManager.tsx.
//
// `banners` still defaults to PLACEHOLDER_BANNERS so this component keeps
// rendering something sensible if ever used without the prop (e.g. a
// future Storybook/preview usage) — page.tsx itself always passes a real
// (possibly empty) array, and banners.length === 0 just renders nothing.
//
// A slide with a linkUrl set (from PromoBannersManager.tsx) renders as an
// <a> wrapping the image; without one it's a plain non-interactive div.

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const AUTOPLAY_INTERVAL_MS = 5000;

export type PromoBanner = {
  id: string;
  imageUrl: string;
  alt: string;
  linkUrl?: string | null;
};

// TEMP placeholder slides — delete once real banners are wired in (phase 2).
// Swap `imageUrl` for real uploaded images to preview real sizing; gradients
// are just stand-ins so the layout/arrows/dots can be reviewed now.
const PLACEHOLDER_BANNERS: PromoBanner[] = [
  {
    id: 'placeholder-1',
    imageUrl: '',
    alt: 'โปรโมชั่นตัวอย่าง 1',
  },
  {
    id: 'placeholder-2',
    imageUrl: '',
    alt: 'โปรโมชั่นตัวอย่าง 2',
  },
  {
    id: 'placeholder-3',
    imageUrl: '',
    alt: 'โปรโมชั่นตัวอย่าง 3',
  },
];

const PLACEHOLDER_GRADIENTS = [
  'from-[#5B8C6E] to-[#0B1E3D]',
  'from-[#C9974A] to-[#5B8C6E]',
  'from-[#0B1E3D] to-[#132a52]',
];

export function PromoBannerSlider({ banners = PLACEHOLDER_BANNERS }: { banners?: PromoBanner[] }) {
  const [active, setActive] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const goTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const slide = index % banners.length;
    track.scrollTo({ left: slide * track.clientWidth, behavior: 'smooth' });
    setActive(slide);
  };

  const step = (dir: 1 | -1) => goTo((active + dir + banners.length) % banners.length);

  useEffect(() => {
    if (banners.length <= 1 || isPaused) return;
    const id = setInterval(() => goTo((active + 1) % banners.length), AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isPaused, banners.length]);

  if (banners.length === 0) return null;

  return (
    <section className="bg-white pt-6 sm:pt-8">
      <div className="mx-auto max-w-6xl px-4">
        <div
          className="group relative overflow-hidden rounded-2xl"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          <div
            ref={trackRef}
            className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={(e) => {
              const track = e.currentTarget;
              const idx = Math.round(track.scrollLeft / track.clientWidth);
              if (idx !== active) setActive(idx);
            }}
          >
            {banners.map((banner, i) => {
              const slideImage = banner.imageUrl ? (
                <Image
                  src={banner.imageUrl}
                  alt={banner.alt}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 1152px"
                  priority={i === 0}
                />
              ) : (
                // Placeholder swatch — stands in for an uploaded banner image
                <div
                  className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${PLACEHOLDER_GRADIENTS[i % PLACEHOLDER_GRADIENTS.length]}`}
                >
                  <span className="px-4 text-center text-sm font-medium text-white/70">
                    {banner.alt} — วางรูปจริงตรงนี้
                  </span>
                </div>
              );

              const slideClassName =
                'relative aspect-[3/1] w-full shrink-0 snap-start sm:aspect-[3.4/1]';

              // banner.linkUrl is free-text set by admins in PromoBannersManager.tsx
              // (can be an internal path or a full external URL) — wrap in a plain
              // <a> rather than next-intl's Link since we can't assume it's a
              // locale-aware internal route.
              return banner.linkUrl ? (
                <a
                  key={banner.id}
                  data-slide
                  href={banner.linkUrl}
                  className={slideClassName}
                >
                  {slideImage}
                </a>
              ) : (
                <div key={banner.id} data-slide className={slideClassName}>
                  {slideImage}
                </div>
              );
            })}
          </div>

          {banners.length > 1 && (
            <>
              <button
                onClick={() => step(-1)}
                aria-label="ก่อนหน้า"
                className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-navy shadow-sm backdrop-blur transition hover:bg-white sm:h-10 sm:w-10"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={() => step(1)}
                aria-label="ถัดไป"
                className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-navy shadow-sm backdrop-blur transition hover:bg-white sm:h-10 sm:w-10"
              >
                <ChevronRight className="h-5 w-5" />
              </button>

              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                {banners.map((banner, i) => (
                  <button
                    key={banner.id}
                    onClick={() => goTo(i)}
                    aria-label={`ไปสไลด์ที่ ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      i === active ? 'w-5 bg-white' : 'w-1.5 bg-white/60'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
