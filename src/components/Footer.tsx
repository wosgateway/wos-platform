import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function Footer() {
  const t = useTranslations('footer');

  const services = t.raw('services') as string[];
  const partners = t.raw('partners') as string[];
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-900 bg-slate-950 text-slate-400">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* ===== Brand ===== */}
          <div>
            <p className="text-lg font-bold text-white">
              WOS<span className="text-accent">.os</span>
            </p>
            <p className="mt-2 text-sm">{t('tagline')}</p>
          </div>

          {/* ===== Services ===== */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white">
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

          {/* ===== Partners ===== */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white">
              {t('partnersTitle')}
            </h3>
            <ul className="space-y-2 text-sm">
              {partners.map((label) => (
                <li key={label}>
                  <Link href="/become-partner" className="hover:text-white">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* ===== Contact ===== */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white">
              {t('contactTitle')}
            </h3>
            <ul className="space-y-2 text-sm">
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
              <li>
                <a href="mailto:hello@wos.asia" className="hover:text-white">
                  hello@wos.asia
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* ===== Legal / Company info ===== */}
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
