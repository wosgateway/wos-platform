'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

/**
 * CategoryCardImage — the only client-side part of CategoryCard.
 *
 * Split out on purpose: CategoryCard itself renders `category.icon`, a
 * lucide-react component reference passed down from the (server) page —
 * functions can't cross the server → client boundary, so making the whole
 * card 'use client' broke with "Functions cannot be passed directly to
 * Client Components" as soon as `category` (icon included) became a prop
 * of a client component. This subcomponent only ever receives plain
 * strings (`src`, `alt`), so it's safe to make client-only, while
 * CategoryCard stays a server component and renders the icon itself.
 *
 * Behavior is the same hover-vs-touch split as HealthGoalFinder.tsx:
 *  - Desktop (`hover: hover` + `pointer: fine`): zooms on mouseenter/leave.
 *  - Touch: zooms in via IntersectionObserver as it scrolls into view,
 *    un-zooms if scrolled back out.
 */
export function CategoryCardImage({ src, alt }: { src: string; alt: string }) {
  const [hovered, setHovered] = useState(false);
  const [inView, setInView] = useState(false);
  const [hasHover, setHasHover] = useState(true);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mql = window.matchMedia('(hover: hover) and (pointer: fine)');
    setHasHover(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setHasHover(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (hasHover || !wrapperRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.55 }
    );
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [hasHover]);

  const isZoomed = hasHover ? hovered : inView;

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={hasHover ? () => setHovered(true) : undefined}
      onMouseLeave={hasHover ? () => setHovered(false) : undefined}
      className="relative h-36 w-full overflow-hidden"
    >
      <Image
        src={src}
        alt={alt}
        fill
        className={`object-cover transition-transform duration-300 ${
          isZoomed ? 'scale-105' : 'scale-100'
        }`}
        sizes="(max-width: 768px) 100vw, 33vw"
      />
    </div>
  );
}
