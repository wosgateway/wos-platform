// src/app/[locale]/become-partner/page.tsx
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { BecomePartnerForm } from '@/components/BecomePartnerForm';

export default function BecomePartnerPage() {
  const t = useTranslations('becomePartner');

  const benefitItems = t.raw('benefits.items') as { icon: string; title: string; desc: string }[];
  const steps = t.raw('howItWorks.steps') as { title: string; desc: string }[];

  return (
    <main>
      {/* ===== HERO ===== */}
      <section className="bg-gradient-to-br from-amber-50 via-white to-primary-light/30 py-16">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">{t('hero.title')}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600">{t('hero.subtitle')}</p>
          <div className="card-shadow mx-auto mt-8 max-w-3xl overflow-hidden rounded-3xl shadow-xl">
            <div className="relative aspect-[2/1] w-full">
              <Image
                src="/images/hero/hero-partner.webp"
                alt={t('hero.title')}
                fill
                className="object-cover"
                sizes="100vw"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* ===== BENEFITS ===== */}
      <section className="bg-white py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="mb-8 text-center text-2xl font-bold text-slate-900">{t('benefits.title')}</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {benefitItems.map((item, i) => (
              <div key={i} className="card-shadow rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center">
                <div className="mb-3 text-4xl">{item.icon}</div>
                <h3 className="font-bold text-slate-900">{item.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="bg-slate-50 py-12">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <h2 className="mb-8 text-center text-2xl font-bold text-slate-900">{t('howItWorks.title')}</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {steps.map((step, i) => (
              <div key={i} className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-white">
                  {i + 1}
                </div>
                <h4 className="font-bold text-slate-900">{step.title}</h4>
                <p className="text-sm text-slate-500">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FORM B2B ===== */}
      <BecomePartnerForm />

      {/* ===== ลิงก์สำหรับพาร์ทเนอร์ที่มีบัญชีอยู่แล้ว ===== */}
      <div className="pb-12 text-center">
        <p className="text-sm text-slate-500">
          {t('alreadyPartner')}{' '}
          <a href="/login" className="font-semibold text-primary hover:underline">
            {t('loginLink')}
          </a>
        </p>
      </div>
    </main>
  );
}
