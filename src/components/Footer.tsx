import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * STEP 12 — Footer hierarchy + mobile pass.
 *
 * What changed from the original 4-even-column layout:
 *  - Brand block is now its own full-width row up top (logo + tagline),
 *    separated by a divider — it was previously squeezed in as "one of
 *    four" columns and read like a nav group instead of the brand anchor.
 *  - The three nav groups underneath are relabeled to the
 *    Explore / Network / Connect framing from the brief (see
 *    footer.servicesTitle/partnersTitle/contactTitle in messages/*.json —
 *    same keys, new header copy, so nothing else that reads those keys
 *    needs to change).
 *  - Group headers now use the small-caps/letter-spaced eyebrow treatment
 *    already established in WhyWosV2 / HealthGoalFinder, for visual
 *    consistency with the rest of the rebuilt homepage.
 *
 * Mobile pass: nav groups now go grid-cols-2 at the smallest breakpoint
 * instead of a single full-width stack — with only 3-5 short items per
 * group this reads as two neat columns on a phone instead of a very long
 * single-file list requiring extra scrolling. This is a distinct,
 * phone-appropriate arrangement, not the desktop grid shrunk down directly.
 */
export function Footer() {
  const t = useTranslations('footer');

  const services = t.raw('services') as string[];
  const partners = t.raw('partners') as string[];
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-900 bg-slate-950 text-slate-400">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        {/* ===== Brand — full-width row, its own visual tier ===== */}
        <div className="border-b border-slate-800 pb-8">
          <p className="text-lg font-bold text-white">
            WOS<span className="text-accent">.os</span>
          </p>
          <p className="mt-2 max-w-sm text-sm">{t('tagline')}</p>
        </div>

        {/* ===== Explore / Network / Connect ===== */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 pt-10 sm:grid-cols-3">
          {/* Explore */}
          <div>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white">
              {t('servicesTitle')}
            </h3>
            <ul className="space-y-2 text-sm">
              {services.map((label) => (
                <li key={label}>
                  <Link href="/#categories" className="hover:text-white">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Network */}
          <div>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white">
              {t('partnersTitle')}
            </h3>
            <ul className="space-y-2 text-sm">
              {partners.map((label) => (
                <li key={label}>
                  <Link href="/partner" className="hover:text-white">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Connect — spans both mobile columns so contact details (phone
              numbers especially) get full width instead of wrapping awkwardly
              in a half-width column */}
          <div id="contact" className="col-span-2 scroll-mt-24 sm:col-span-1">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white">
              {t('contactTitle')}
            </h3>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:block sm:space-y-2">
              <li>
                <a href="tel:+66855907666" className="hover:text-white">
                  {t('contactPhoneTh')}
                </a>
              </li>
              <li>
                <a href="tel:+8562098724718" className="hover:text-white">
                  {t('contactPhoneLo')}
                </a>
              </li>
              <li>
                <a
                  href="https://line.me/ti/p/@vlf9996z"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white"
                >
                  LINE OA: @vlf9996z
                </a>
              </li>
              <li>
                <a
                  href="https://wa.me/message/BVJXBWDYR2UHN1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white"
                >
                  WhatsApp
                </a>
              </li>
              <li className="col-span-2">
                <a href="mailto:hello@wos.asia" className="hover:text-white">
                  hello@wos.asia
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* ===== Legal / Company info =====
            NOTE: the dev comment that used to live here explaining why
            privacyPolicy is plain text (no /privacy page exists yet, so no
            <Link>) got corrupted into unreadable mojibake somewhere in a
            prior export/repackage step. Re-stated here in clean Thai; the
            actual behavior (plain text, not a link) is unchanged — swap in
            <Link href="/privacy"> once that page exists. */}
        <div className="mt-10 border-t border-slate-800 pt-6 text-center text-xs leading-relaxed text-slate-500">
          <p>{t('companyLine')}</p>
          <p className="mt-1">
            &copy; {year} WOS. {t('rightsReserved')}
            {' · '}
            {/* ยังไม่มีหน้านโยบายความเป็นส่วนตัวในเว็บใหม่ — ใส่เป็นข้อความเฉยๆ
                ไม่ทำเป็นลิงก์ เพื่อไม่ให้เกิด 404 ซ้ำแบบ /partner เดิม
                (สร้างหน้า /privacy แล้วค่อยเปลี่ยนเป็น <Link href="/privacy"> ทีหลังได้) */}
            {t('privacyPolicy')}
          </p>
        </div>
      </div>
    </footer>
  );
}
