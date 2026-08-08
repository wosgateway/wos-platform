'use client';

import Image from 'next/image';
import { useState, useEffect, useCallback, useRef } from 'react';

type Slide = {
  src: string;
  alt: string;
};

const AUTOPLAY_INTERVAL = 4000;

export default function HeroSlider({ slides }: { slides: Slide[] }) {
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((index: number) => {
    setCurrent((index + slides.length) % slides.length);
  }, [slides.length]);

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (isPaused || prefersReducedMotion || slides.length <= 1) return;

    timerRef.current = setInterval(next, AUTOPLAY_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, next, slides.length]);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {slides.map((slide, index) => (
        <div
          key={slide.src}
          className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
            index === current ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden={index !== current}
        >
          <Image
            src={slide.src}
            alt={slide.alt}
            fill
            priority={index === 0}
            className="object-cover"
            sizes="100vw"
          />
        </div>
      ))}

      {/* Overlay สีแบรนด์ ให้ text อ่านง่าย + ดูเป็น WOS ไม่ใช่ template ทั่วไป */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/85 via-primary/55 to-slate-900/45" />

      {/* dark vignette เฉพาะโซนล่าง — จุดที่ TrustBar (ตัวเลข 1,000+ / 50+ ฯลฯ)
          และ CTA วางอยู่ เข้มขึ้นอีกขั้นจากเดิม (70/30 -> 80/40) เพราะพื้นหลังตรงนั้น
          บางสไลด์ยังสว่างพอที่ตัวเลข/ตัวหนังสือขาวจะกลืนได้อยู่ */}
      <div className="absolute inset-x-0 bottom-0 h-[50%] bg-gradient-to-t from-slate-950/80 via-slate-950/40 to-transparent" />

      {slides.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => goTo(index)}
              aria-label={`ไปสไลด์ที่ ${index + 1}`}
              className={`h-2 rounded-full transition-all ${
                index === current ? 'w-8 bg-white' : 'w-2 bg-white/50 hover:bg-white/80'
              }`}
            />
          ))}
        </div>
      )}

      {slides.length > 1 && (
        <>
          <button
            onClick={prev}
            aria-label="สไลด์ก่อนหน้า"
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 backdrop-blur-sm flex items-center justify-center text-white transition"
          >
            ‹
          </button>
          <button
            onClick={next}
            aria-label="สไลด์ถัดไป"
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 backdrop-blur-sm flex items-center justify-center text-white transition"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
