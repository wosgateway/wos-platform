// src/app/[locale]/privacy/page.tsx
// หน้านโยบายความเป็นส่วนตัว — ปลายทางของลิงก์ footer.privacyPolicy
// (components/Footer.tsx) เนื้อหาทั้ง 3 ภาษาอยู่ใน messages/*.json
// namespace `privacy` (pageTitle, lastUpdated, intro, sections[])
//
// โครงสร้าง section รองรับได้หลายแบบ (ดูตัวอย่างใน messages/th.json):
//  - paragraphs: string[]                 ย่อหน้าเนื้อหาปกติ
//  - items: string[]                      บูลเลตลิสต์เดี่ยว
//  - fields: {label, value}[]             รายการ label/value (เช่นข้อมูลบริษัท)
//  - subsections: {subtitle, items, note?}[]  หัวข้อย่อยแบบ 2.1, 2.2 ฯลฯ
//  - extra: string[]                      ย่อหน้าเสริมหลัง items
//  - closing: string                      ย่อหน้าปิดท้าย section

import { getTranslations } from 'next-intl/server';
import { Breadcrumb } from '@/components/Breadcrumb';

interface Field {
  label: string;
  value: string;
}

interface Subsection {
  subtitle: string;
  items?: string[];
  note?: string;
}

interface Section {
  title: string;
  paragraphs?: string[];
  items?: string[];
  fields?: Field[];
  subsections?: Subsection[];
  extra?: string[];
  closing?: string;
}

export default async function PrivacyPolicyPage() {
  const t = await getTranslations('privacy');
  const pageTitle = t('pageTitle');
  const lastUpdated = t('lastUpdated');
  const intro = t.raw('intro') as string[];
  const sections = t.raw('sections') as Section[];

  return (
    <main>
      <Breadcrumb trail={[{ label: pageTitle }]} />

      <section className="pb-20 pt-4">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{pageTitle}</h1>
          <p className="mt-2 text-sm text-slate-500">{lastUpdated}</p>

          <div className="mt-8 space-y-4">
            {intro.map((para, i) => (
              <p key={i} className="leading-relaxed text-slate-600">
                {para}
              </p>
            ))}
          </div>

          <div className="mt-10 divide-y divide-slate-100">
            {sections.map((section, i) => (
              <div key={i} className="py-8 first:pt-0">
                <h2 className="text-lg font-bold text-slate-900">{section.title}</h2>

                {section.paragraphs?.map((para, j) => (
                  <p key={j} className="mt-3 leading-relaxed text-slate-600">
                    {para}
                  </p>
                ))}

                {section.fields && (
                  <dl className="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
                    {section.fields.map((field, j) => (
                      <div key={j} className="flex flex-col sm:flex-row sm:gap-2">
                        <dt className="font-semibold text-slate-700 sm:w-56 sm:flex-none">
                          {field.label}
                        </dt>
                        <dd className="text-slate-600">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {section.items && (
                  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-slate-600">
                    {section.items.map((item, j) => (
                      <li key={j} className="leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}

                {section.subsections?.map((sub, j) => (
                  <div key={j} className="mt-5">
                    <h3 className="font-semibold text-slate-800">{sub.subtitle}</h3>
                    {sub.items && (
                      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-slate-600">
                        {sub.items.map((item, k) => (
                          <li key={k} className="leading-relaxed">
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                    {sub.note && (
                      <p className="mt-2 leading-relaxed text-slate-500">{sub.note}</p>
                    )}
                  </div>
                ))}

                {section.extra?.map((para, j) => (
                  <p key={j} className="mt-3 leading-relaxed text-slate-600">
                    {para}
                  </p>
                ))}

                {section.closing && (
                  <p className="mt-3 leading-relaxed text-slate-600">{section.closing}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
