// app/[locale]/partner/terms/page.tsx
//
// Supporting page for /partner. Everything the redesign brief moved OFF the
// landing page lives here: commission / fee schedule, settlement cycle,
// contract duration, MOU contents and signing steps, responsibilities and SLA.
// Nothing was deleted — it's just no longer in the way of the sales story.

import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getPartnerContent, partnerLocales } from "@/content/partner";
import "../partner-theme.css";

interface PageProps {
  params: { locale: string };
}

export function generateStaticParams() {
  return partnerLocales.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: PageProps): Metadata {
  const content = getPartnerContent(params.locale);
  return {
    title: `${content.termsPage.headline} | WOS Partner`,
    description: content.termsPage.intro,
  };
}

export default function PartnerTermsPage({ params }: PageProps) {
  const content = getPartnerContent(params.locale);
  const { termsPage, commercialTerms, mou, responsibilitiesSla: rs, locale } = content;

  const t = (th: string, lo: string, en: string) => (locale === "th" ? th : locale === "lo" ? lo : en);

  return (
    <main className="wos-partner">
      <section className="wos-section wos-hero wos-terms-hero">
        <div className="wos-shell">
          <Link href="/partner" className="wos-back-link">
            {termsPage.backLabel}
          </Link>
          <span className="wos-eyebrow">{termsPage.eyebrow}</span>
          <h1 className="wos-display">{termsPage.headline}</h1>
          <p className="wos-lead">{termsPage.intro}</p>
        </div>
      </section>

      {/* Commercial terms + fee schedule */}
      <section className="wos-section" id="commercial-terms">
        <div className="wos-shell">
          <header className="wos-section-head">
            <span className="wos-eyebrow">01 — Commercial Terms</span>
            <h2 className="wos-display">{commercialTerms.headline}</h2>
            <p>{commercialTerms.intro}</p>
          </header>

          <div className="wos-doc">
            <span className="wos-label">{commercialTerms.docStamp}</span>
            <table className="wos-term-table">
              <tbody>
                {commercialTerms.terms.map((term) => (
                  <tr key={term.label}>
                    <td>{term.label}</td>
                    <td>
                      {term.value}
                      {term.note ? <span className="wos-term-note">{term.note}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="wos-note">{commercialTerms.disclaimer}</p>
          </div>

          <div className="wos-doc">
            <span className="wos-label">{t("อัตราค่าธรรมเนียม", "ອັດຕາຄ່າທຳນຽມ", "Fee schedule")}</span>
            <h3 className="wos-subhead">{commercialTerms.feeScheduleHeadline}</h3>
            <div className="wos-table-wrap">
              <table className="wos-fee-table">
                <thead>
                  <tr>
                    <th>{t("ประเภท Partner", "ປະເພດ Partner", "Partner type")}</th>
                    <th>{t("ค่าธรรมเนียม", "ຄ່າທຳນຽມ", "WOS fee")}</th>
                    <th>{t("หลักการ", "ຫຼັກການ", "Basis")}</th>
                  </tr>
                </thead>
                <tbody>
                  {commercialTerms.feeSchedule.map((row) => (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td className="wos-fee-value">{row.fee}</td>
                      <td>{row.principle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="wos-note">{commercialTerms.feeScheduleNote}</p>
          </div>
        </div>
      </section>

      {/* MOU */}
      <section className="wos-section wos-section-beige" id="mou">
        <div className="wos-shell">
          <header className="wos-section-head">
            <span className="wos-eyebrow">02 — MOU / Agreement</span>
            <h2 className="wos-display">{mou.headline}</h2>
            <p>{mou.intro}</p>
          </header>

          <div className="wos-two-col">
            <div className="wos-doc">
              <span className="wos-label">
                {t("เอกสารประกอบด้วย", "ເອກະສານປະກອບດ້ວຍ", "Document includes")}
              </span>
              <ul className="wos-plain-list">
                {mou.documentIncludes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="wos-doc">
              <span className="wos-label">{t("ขั้นตอนการลงนาม", "ຂັ້ນຕອນການລົງນາມ", "Signing steps")}</span>
              <ol className="wos-ordered-list">
                {mou.signingSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
          <p className="wos-note">{mou.downloadNote}</p>
        </div>
      </section>

      {/* Responsibilities + SLA */}
      <section className="wos-section" id="responsibilities">
        <div className="wos-shell">
          <header className="wos-section-head">
            <span className="wos-eyebrow">03 — Responsibilities &amp; SLA</span>
            <h2 className="wos-display">{rs.headline}</h2>
            <p>{rs.intro}</p>
          </header>

          <div className="wos-table-wrap">
            <table className="wos-resp-table">
              <thead>
                <tr>
                  <th>{t("หัวข้อ", "ຫົວຂໍ້", "Area")}</th>
                  <th>WOS</th>
                  <th>{t("พันธมิตร", "ຄູ່ຮ່ວມທຸລະກິດ", "Partner")}</th>
                </tr>
              </thead>
              <tbody>
                {rs.responsibilities.map((row) => (
                  <tr key={row.area}>
                    <td>{row.area}</td>
                    <td>{row.wos}</td>
                    <td>{row.partner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="wos-subhead wos-subhead-spaced">{rs.slaHeadline}</h3>
          <div className="wos-grid-3">
            {rs.slaItems.map((item) => (
              <div className="wos-card" key={item.label}>
                <span className="wos-label">{item.label}</span>
                <h3>{item.target}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="wos-section wos-section-navy wos-closing">
        <div className="wos-shell">
          <h2 className="wos-display">{termsPage.ctaHeadline}</h2>
          <div className="wos-cta-row">
            <Link href={termsPage.cta.href} className="wos-btn wos-btn-gold wos-btn-lg">
              {termsPage.cta.label}
            </Link>
            <Link href="/partner" className="wos-btn-ghost wos-btn-ghost-light">
              {termsPage.backLabel}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
