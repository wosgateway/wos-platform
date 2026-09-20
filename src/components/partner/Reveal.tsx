"use client";

// components/partner/Reveal.tsx
//
// Subtle on-scroll reveal for the partner page: a short fade + 12px rise,
// once per element. Deliberately minimal — the visual brief rules out
// parallax, floating elements and per-card animation.
//
// If IntersectionObserver is unavailable or the visitor prefers reduced
// motion, content is shown immediately (the CSS class is additive, never
// a precondition for visibility).

import { useEffect, useRef, useState } from "react";

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  /** Stagger in ms, for grids. Keep under ~200ms total. */
  delay?: number;
  as?: "div" | "section" | "li" | "article";
}

export function Reveal({ children, className = "", delay = 0, as = "div" }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const Tag = as;

  return (
    <Tag
      ref={ref as React.RefObject<never>}
      className={`wos-reveal ${shown ? "is-visible" : ""} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
