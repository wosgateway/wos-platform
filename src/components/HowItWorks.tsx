// src/components/HowItWorks.tsx
// ส่วนใหม่สำหรับหน้าแรก — ใช้ key "home.howItWorks" ที่เพิ่มไว้ใน th/en/lo.json แล้ว
// วางไว้ระหว่าง "Popular Programs / Categories" กับ "Featured Partners" ตาม flow ที่คุยกัน:
// Hero -> Popular Programs -> Health Goals (categories) -> Featured Partners -> How WOS Works -> Testimonials -> Become Partner

import { useTranslations } from 'next-intl';

export function HowItWorks() {
  const t = useTranslations('home.howItWorks');
  const steps = t.raw('steps') as { icon: string; title: string; desc: string }[];

  return (
    <section className="bg-sand py-16 md:py-20">
      <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t('title')}</h2>
        <p className="mx-auto mt-3 max-w-xl text-slate-600">{t('subtitle')}</p>

        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((step, i) => (
            <div key={i} className="relative flex flex-col items-center">
              {/* connector line (desktop only) */}
              {i < steps.length - 1 && (
                <div
                  className="absolute left-1/2 top-8 hidden h-px w-full bg-primary/20 md:block"
                  style={{ transform: 'translateX(50%)' }}
                  aria-hidden
                />
              )}
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary-light text-3xl">
                {step.icon}
              </div>
              <h3 className="mt-4 font-bold text-slate-900">{step.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
