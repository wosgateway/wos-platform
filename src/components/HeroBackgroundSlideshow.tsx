'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

export type HeroImage = { src: string; alt: string };

/**
 * HeroBackgroundSlideshow — crossfades through 2–3 hero background photos.
 *
 * Renders every image absolutely-stacked on top of each other and animates
 * `opacity` between them, so there's never a blank frame (unlike swapping
 * `src` on a single <Image>, which flashes while the new file decodes).
 *
 * - Cycles automatically every `intervalMs` (default 6s hold + 1.2s fade).
 * - Respects `prefers-reduced-motion`: shows the first image only, no timer.
 * - If only one image is passed, renders it statically (no slideshow logic).
 * - `objectPosition` / `sizes` are shared across all images — pass a single
 *   crop that works for every photo in the set (see hero-1's existing
 *   `object-[78%_18%]` convention in HeroV2).
 */
export default function HeroBackgroundSlideshow({
  images,
  objectPosition = '50% 20%',
  sizes,
  priority = true,
  className = '',
}: {
  images: HeroImage[];
  objectPosition?: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (images.length <= 1) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const HOLD_MS = 6000;
    const timer = setInterval(() => {
      setActiveIndex((i) => (i + 1) % images.length);
    }, HOLD_MS);

    return () => clearInterval(timer);
  }, [images.length]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      {images.map((img, i) => (
        <Image
          key={img.src}
          src={img.src}
          alt={img.alt}
          fill
          priority={priority && i === 0}
          className="object-cover transition-opacity duration-[1200ms] ease-in-out"
          style={{
            objectPosition,
            opacity: i === activeIndex ? 1 : 0,
          }}
          sizes={sizes}
        />
      ))}
    </div>
  );
}
