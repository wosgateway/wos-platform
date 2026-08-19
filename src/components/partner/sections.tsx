// components/partner/sections.tsx
//
// Presentational sections for the /partner overview page. Pure, content-driven,
// no data fetching — pass in the resolved PartnerPageContent for the current locale.

import Link from "next/link";
import Image from "next/image";
import type { PartnerPageContent } from "@/content/partner/types";

export function PartnerHero({ content }: { content: PartnerPageContent }) {
  const { hero } = content;
  return (
    <section className="wos-section wos-hero">
      <div className="wos-shell wos-hero-grid">
        <div>
          <span className="wos-eyebrow">{hero.eyebrow}</span>
          <h1 className="wos-display">{hero.headline}</h1>
          <p>{hero.subheadline}</p>
          <Link href={hero.ctaLink} className="wos-btn">
            {hero.ctaText}
          </Link>
        </div>

        <div className="wos-pass" role="img" aria-label={hero.boardingLabel}>
          <div className="wos-pass-row">
            <span className="wos-pass-code">WOS · {hero.boardingLabel}</span>
            <span className="wos-seal-badge">Trust Standard</span>
          </div>
          <div className="wos-pass-cut" />
          <p className="wos-pass-headline">Medical Tourism Network</p>
          <p className="wos-pass-sub">Thailand ‡„ Laos ‡„ Asia</p>
          <div className="wos-pass-cut" />
          <div className="wos-pass-row">
            <span className="wos-pass-code">GATE / PARTNER</span>
            <span className="wos-pass-code">STATUS / OPEN</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function WhyPartner({ content }: { content: PartnerPageContent }) {
  return (
    <section className="wos-section">
      <div className="wos-shell">
        <div className="wos-section-head">
          <span className="wos-eyebrow">01 — Partner Overview</span>
          <h2 className="wos-display">{content.whyPartner.headline}</h2>
        </div>
        <div className="wos-reason-grid">
          {content.whyPartner.reasons.map((reason) => (
            <div className="wos-reason" key={reason.code}>
              <span className="wos-pass-code">{reason.code}</span>
              <div className="wos-reason-icon">{reason.icon}</div>
              <h3>{reason.title}</h3>
              <p>{reason.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PartnerTypes({ content }: { content: PartnerPageContent }) {
  return (
    <section className="wos-section">
      <div className="wos-shell">
        <div className="wos-section-head">
          <span className="wos-eyebrow">02 — Partner Types</span>
          <h2 className="wos-display">
            {content.locale === "th"
              ? "ประเภทพันธมิตร"
              : content.locale === "lo"
                ? "ປະເພດຄູ່ຮ່ວມທຸລະກິດ"
                : "Partner Types"}
          </h2>
        </div>
        <div className="wos-stub-grid">
          {content.partnerTypes.map((type) => (
            <article className="wos-stub" key={type.code}>
              <div className="wos-stub-top">
                <div className="wos-pass-row">
                  <span className="wos-stub-icon">{type.icon}</span>
                  <span className="wos-pass-code">{type.code}</span>
                </div>
                <h3>{type.name}</h3>
                <p className="wos-stub-desc">{type.description}</p>
              </div>
              <div className="wos-stub-perf" />
              <div className="wos-stub-bottom">
                <div className="wos-tag-list">
                  {type.subTypes.map((sub) => (
                    <span className="wos-tag" key={sub}>
                      {sub}
                    </span>
                  ))}
                </div>
                <ul className="wos-req-list">
                  {type.requirements.map((req) => (
                    <li key={req}>{req}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks({ content }: { content: PartnerPageContent }) {
  return (
    <section className="wos-section">
      <div className="wos-shell">
        <div className="wos-section-head">
          <span className="wos-eyebrow">03 — Partnership Process</span>
          <h2 className="wos-display">
            {content.locale === "th"
              ? "ขั้นตอนการเป็นพันธมิตร"
              : content.locale === "lo"
                ? "ຂັ້ນຕອນການເປັນຄູ່ຮ່ວມທຸລະກິດ"
                : "How Partnership Works"}
          </h2>
        </div>
        <div className="wos-itinerary">
          {content.howItWorks.map((step) => (
            <div className="wos-leg" key={step.stepNumber}>
              <div className="wos-leg-num">{String(step.stepNumber).padStart(2, "0")}</div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              <span className="wos-leg-duration">{step.duration}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function OperatingModel({ content }: { content: PartnerPageContent }) {
  const { operatingModel } = content;
  return (
    <section className="wos-section">
      <div className="wos-shell">
        <div className="wos-section-head">
          <span className="wos-eyebrow">Operating Model</span>
          <h2 className="wos-display">{operatingModel.headline}</h2>
        </div>
        <div className="wos-flow-strip">
          {operatingModel.flowSteps.map((node) => (
            <div className="wos-flow-node" key={node}>
              {node}
            </div>
          ))}
        </div>
        <ul className="wos-keypoints">
          {operatingModel.keyPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Benefits({ content }: { content: PartnerPageContent }) {
  return (
    <section className="wos-section">
      <div className="wos-shell">
        <div className="wos-section-head">
          <span className="wos-eyebrow">04 — Benefits</span>
          <h2 className="wos-display">
            {content.locale === "th"
              ? "สิทธิประโยชน์ของพันธมิตร"
              : content.locale === "lo"
                ? "ຜົນປະໂຫຍດຂອງຄູ່ຮ່ວມທຸລະກິດ"
                : "Partner Benefits"}
          </h2>
        </div>
        <div className="wos-benefit-grid">
          {content.benefits.map((benefit) => (
            <div className="wos-benefit" key={benefit.title}>
              <div className="wos-benefit-icon">{benefit.icon}</div>
              <h3>{benefit.title}</h3>
              <p>{benefit.description}</p>
              <div className="wos-tag-list">
                {benefit.features.map((f) => (
                  <span className="wos-tag" key={f}>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CommercialTermsSection({ content }: { content: PartnerPageContent }) {
  const { commercialTerms } = content;
  return (
    <section className="wos-section">
      <div className="wos-shell">
        <div className="wos-section-head">
          <span className="wos-eyebrow">05 — Commercial Terms</span>
          <h2 className="wos-display">{commercialTerms.headline}</h2>
          <p>{commercialTerms.intro}</p>
        </div>
        <div className="wos-doc">
          <span className="wos-doc-stamp">Draft</span>
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
          <p className="wos-disclaimer">{commercialTerms.disclaimer}</p>
        </div>
      </div>
    </section>
  );
}

export function MouSection({ content }: { content: PartnerPageContent }) {
  const { mou } = content;
  return (
    <section className="wos-section">
      <div className="wos-shell">
        <div className="wos-section-head">
          <span className="wos-eyebrow">06 — MOU / Agreement</span>
          <h2 className="wos-display">{mou.headline}</h2>
          <p>{mou.intro}</p>
        </div>
        <div className="wos-two-col">
          <div className="wos-doc">
            <span className="wos-doc-stamp">Contents</span>
            <h3 className="wos-pass-headline">
              {content.locale === "th" ? "เอกสารประกอบด้วย" : content.locale === "lo" ? "ເອກະສານປະກອບດ້ວຍ" : "Document includes"}
            </h3>
            <ul className="wos-doc-list">
              {mou.documentIncludes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="wos-doc">
            <span className="wos-doc-stamp">Process</span>
            <h3 className="wos-pass-headline">
              {content.locale === "th" ? "ขั้นตอนการลงนาม" : content.locale === "lo" ? "ຂັ້ນຕອນການລົງນາມ" : "Signing steps"}
            </h3>
            <ol className="wos-doc-steps">
              {mou.signingSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ResponsibilitiesSlaSection({ content }: { content: PartnerPageContent }) {
  const { responsibilitiesSla: r } = content;
  const colWos = content.locale === "th" ? "WOS" : content.locale === "lo" ? "WOS" : "WOS";
  const colPartner = content.locale === "th" ? "พันธมิตร" : content.locale === "lo" ? "ຄູ່ຮ່ວມທຸລະກິດ" : "Partner";
  const colArea = content.locale === "th" ? "หัวข้อ" : content.locale === "lo" ? "ຫົວຂໍ້" : "Area";
  return (
    <section className="wos-section">
      <div className="wos-shell">
        <div className="wos-section-head">
          <span className="wos-eyebrow">07 — Responsibilities & SLA</span>
          <h2 className="wos-display">{r.headline}</h2>
          <p>{r.intro}</p>
        </div>
        <table className="wos-resp-table">
          <thead>
            <tr>
              <th>{colArea}</th>
              <th>{colWos}</th>
              <th>{colPartner}</th>
            </tr>
          </thead>
          <tbody>
            {r.responsibilities.map((row) => (
              <tr key={row.area}>
                <td>{row.area}</td>
                <td>{row.wos}</td>
                <td>{row.partner}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="wos-pass-headline" style={{ marginTop: 32 }}>
          {r.slaHeadline}
        </h3>
        <div className="wos-sla-grid">
          {r.slaItems.map((item) => (
            <div className="wos-sla-item" key={item.label}>
              <span className="wos-pass-code">{item.label}</span>
              <div className="wos-sla-target">{item.target}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PartnerCta({ content }: { content: PartnerPageContent }) {
  const { cta } = content;
  return (
    <section className="wos-section">
      <div className="wos-shell">
        <div className="wos-cta">
          <Image
            src="/images/handshake-partner.webp"
            alt=""
            fill
            sizes="(max-width: 860px) 100vw, 1120px"
            className="wos-cta-photo"
            priority={false}
          />
          <div className="wos-cta-scrim" />
          <div className="wos-cta-content">
            <span className="wos-eyebrow">{cta.gateLabel}</span>
            <h2>{cta.headline}</h2>
            <p>{cta.subtext}</p>
          </div>
          <Link href={cta.buttonLink} className="wos-btn wos-cta-content">
            {cta.buttonText}
          </Link>
        </div>
      </div>
    </section>
  );
}
