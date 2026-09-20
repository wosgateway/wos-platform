// components/partner/sections.tsx
//
// Partner landing page sections, image-led (visual brief v2).
//
// Rule the layouts are built around:
//   "Every major section should have either a strong image or strong
//    typography — never a wall of text."
//
// 01 Hero            big image right + LAOS → WOS → THAILAND overlay
// 02 Why WOS         image left / three short points right
// 03 Journey         wide panorama + journey rail underneath
// 04 Who Can Join    three-image grid
// 05 Founding        navy split: type one side, image the other
// 06 How It Works    four small "moments" with numbers
// 07 Commercial      pure editorial typography, no photography
// 08 Requirements    checklist left / image right
// 09 Final CTA       full-bleed image with a navy scrim
//
// No emoji, no icon library — a hairline arrow and a hairline check only.

import Image from "next/image";
import { Link } from "@/i18n/navigation";
import type { PartnerPageContent } from "@/content/partner/types";
import { getPartnerImages } from "@/content/partner/images";
import { Reveal } from "./Reveal";

/* ---------- hairline marks ---------- */

function ArrowRight() {
  return (
    <svg className="wos-arrow" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
      <path d="M0 6h17M12 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg className="wos-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/* ---------- 01 — Hero ---------- */

export function PartnerHero({ content }: { content: PartnerPageContent }) {
  const { hero } = content;
  const img = getPartnerImages(content.locale);

  return (
    <section className="wos-section wos-hero" id="top">
      <div className="wos-shell wos-hero-grid">
        <div className="wos-hero-copy">
          <span className="wos-eyebrow">{hero.eyebrow}</span>
          <h1 className="wos-display">
            {hero.headlineLines.map((line, i) => (
              <span className="wos-hero-line" key={i}>
                {line}
              </span>
            ))}
          </h1>
          <p className="wos-lead">{hero.description}</p>
          <div className="wos-cta-row">
            <Link href={hero.primaryCta.href} className="wos-btn wos-btn-gold">
              {hero.primaryCta.label}
              <ArrowRight />
            </Link>
            <a href={hero.secondaryCta.href} className="wos-btn-ghost">
              {hero.secondaryCta.label}
            </a>
          </div>
        </div>

        <div className="wos-hero-media">
          <figure className="wos-figure wos-ratio-16x9">
            <Image
              src={img.hero.src}
              alt={img.hero.alt}
              fill
              priority
              sizes="(max-width: 1023px) 100vw, 55vw"
              className="wos-img"
            />
          </figure>
          <div className="wos-route-overlay" aria-hidden="true">
            <span>{hero.visual.from}</span>
            <span className="wos-route-dash" />
            <span className="wos-route-core">{hero.visual.via}</span>
            <span className="wos-route-dash" />
            <span>{hero.visual.to}</span>
          </div>
          <span className="wos-hero-highlight">{hero.highlight}</span>
        </div>
      </div>
    </section>
  );
}

/* ---------- 02 — Why WOS ---------- */

export function WhyPartner({ content }: { content: PartnerPageContent }) {
  const { whyPartner } = content;
  const img = getPartnerImages(content.locale);

  return (
    <section className="wos-section wos-section-beige" id="why-partner">
      <div className="wos-shell wos-split">
        <Reveal className="wos-split-media">
          <figure className="wos-figure wos-ratio-4x3">
            <Image
              src={img.whyPartner.src}
              alt={img.whyPartner.alt}
              fill
              sizes="(max-width: 1023px) 100vw, 45vw"
              className="wos-img"
            />
          </figure>
        </Reveal>

        <div className="wos-split-copy">
          <span className="wos-eyebrow">{whyPartner.eyebrow}</span>
          <h2 className="wos-display wos-display-lg">{whyPartner.headline}</h2>
          <p className="wos-lead">{whyPartner.subheadline}</p>

          <div className="wos-point-list">
            {whyPartner.cards.map((card, i) => (
              <Reveal className="wos-point" key={card.index} delay={i * 60}>
                <span className="wos-index">{card.index}</span>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- 03 — One complete journey ---------- */

export function JourneySection({ content }: { content: PartnerPageContent }) {
  const { journey } = content;
  const img = getPartnerImages(content.locale);

  return (
    <section className="wos-section" id="journey">
      <div className="wos-shell">
        <header className="wos-section-head wos-section-head-center">
          <span className="wos-eyebrow">{journey.eyebrow}</span>
          <h2 className="wos-display wos-display-lg">{journey.headline}</h2>
          <p className="wos-subhead">{journey.subheadline}</p>
        </header>
      </div>

      <Reveal className="wos-shell">
        <figure className="wos-figure wos-ratio-21x9 wos-figure-wide">
          <Image
            src={img.journey.src}
            alt={img.journey.alt}
            fill
            sizes="100vw"
            className="wos-img"
          />
          <div className="wos-figure-scrim" />
          <figcaption className="wos-figure-caption">{journey.highlightTitle}</figcaption>
        </figure>
      </Reveal>

      <div className="wos-shell">
        <ol className="wos-journey">
          {journey.steps.map((step, i) => (
            <Reveal as="li" className="wos-journey-step" key={step.index} delay={i * 50}>
              <span className="wos-journey-index">{step.index}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </Reveal>
          ))}
        </ol>

        <p className="wos-journey-note">{journey.highlightText}</p>
      </div>
    </section>
  );
}

/* ---------- 04 — Who can join ---------- */

export function WhoCanJoin({ content }: { content: PartnerPageContent }) {
  const { whoCanJoin } = content;
  const img = getPartnerImages(content.locale);
  const media = [img.healthcare, img.wellness, img.hospitality];

  return (
    <section className="wos-section wos-section-beige" id="who-can-join">
      <div className="wos-shell">
        <header className="wos-section-head">
          <span className="wos-eyebrow">{whoCanJoin.eyebrow}</span>
          <h2 className="wos-display wos-display-lg">{whoCanJoin.headline}</h2>
          <p className="wos-lead">{whoCanJoin.intro}</p>
        </header>

        <div className="wos-image-grid">
          {whoCanJoin.groups.map((group, i) => (
            <Reveal as="article" className="wos-image-card" key={group.name} delay={i * 70}>
              <figure className="wos-figure wos-ratio-4x3">
                <Image
                  src={media[i].src}
                  alt={media[i].alt}
                  fill
                  sizes="(max-width: 719px) 100vw, (max-width: 1023px) 50vw, 33vw"
                  className="wos-img"
                />
              </figure>
              <h3>{group.name}</h3>
              <p>{group.items.join(" · ")}</p>
            </Reveal>
          ))}
        </div>

        <p className="wos-note">{whoCanJoin.note}</p>
      </div>
    </section>
  );
}

/* ---------- 05 — Founding partner ---------- */

export function FoundingPartner({ content }: { content: PartnerPageContent }) {
  const { foundingPartner: fp } = content;
  const img = getPartnerImages(content.locale);

  return (
    <section className="wos-section wos-section-navy wos-founding" id="founding-partner">
      <div className="wos-shell wos-split wos-split-reverse">
        <div className="wos-split-copy">
          <span className="wos-eyebrow">{fp.eyebrow}</span>
          <h2 className="wos-display wos-display-xl">
            <span className="wos-hero-line">WOS</span>
            <span className="wos-hero-line wos-display-gold">FOUNDING PARTNER</span>
          </h2>
          <p className="wos-subhead">{fp.headline}</p>
          <p className="wos-lead">{fp.intro}</p>
          <span className="wos-badge">{fp.badge}</span>
        </div>

        <Reveal className="wos-split-media">
          <figure className="wos-figure wos-ratio-4x5">
            <Image
              src={img.founding.src}
              alt={img.founding.alt}
              fill
              sizes="(max-width: 1023px) 100vw, 45vw"
              className="wos-img"
            />
          </figure>
        </Reveal>
      </div>

      <div className="wos-shell">
        <ul className="wos-privilege-list">
          {fp.privileges.map((item) => (
            <li key={item.title}>
              <CheckMark />
              <span>
                <strong>{item.title}</strong>
                <em>{item.description}</em>
              </span>
            </li>
          ))}
        </ul>

        <div className="wos-cta-row">
          <Link href={fp.cta.href} className="wos-btn wos-btn-gold">
            {fp.cta.label}
            <ArrowRight />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------- 06 — How it works ---------- */

export function HowItWorks({ content }: { content: PartnerPageContent }) {
  const { howItWorks } = content;
  const img = getPartnerImages(content.locale);
  const media = [img.step01, img.step02, img.step03, img.step04];

  return (
    <section className="wos-section" id="how-it-works">
      <div className="wos-shell">
        <header className="wos-section-head">
          <span className="wos-eyebrow">{howItWorks.eyebrow}</span>
          <h2 className="wos-display wos-display-lg">{howItWorks.headline}</h2>
        </header>

        <ol className="wos-moments">
          {howItWorks.steps.map((step, i) => (
            <Reveal as="li" className="wos-moment" key={step.index} delay={i * 60}>
              <figure className="wos-figure wos-ratio-4x3">
                <Image
                  src={media[i].src}
                  alt={media[i].alt}
                  fill
                  sizes="(max-width: 719px) 100vw, (max-width: 1023px) 50vw, 25vw"
                  className="wos-img"
                />
              </figure>
              <span className="wos-index">{step.index}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </Reveal>
          ))}
        </ol>

        <div className="wos-inline-cta">
          <p className="wos-subhead">{howItWorks.ctaHeadline}</p>
          <Link href={howItWorks.cta.href} className="wos-btn">
            {howItWorks.cta.label}
            <ArrowRight />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------- 07 — Commercial model (typography only) ---------- */

export function CommercialModel({ content }: { content: PartnerPageContent }) {
  const { commercialModel: cm } = content;

  return (
    <section className="wos-section wos-commercial" id="commercial-model">
      <div className="wos-shell">
        <header className="wos-section-head">
          <span className="wos-eyebrow">{cm.eyebrow}</span>
          <h2 className="wos-display wos-display-xl">
            <span className="wos-hero-line">Simple &amp;</span>
            <span className="wos-hero-line">Performance-Based</span>
          </h2>
          <p className="wos-lead">{cm.subheadline}</p>
        </header>

        <div className="wos-terms-row">
          {cm.cards.map((card, i) => (
            <Reveal className="wos-term-block" key={card.term} delay={i * 60}>
              <span className="wos-term-lead">{card.lead}</span>
              <h3 className="wos-term-word">{card.term}</h3>
              <p>{card.note}</p>
            </Reveal>
          ))}
        </div>

        <Link href={cm.termsLink.href} className="wos-link">
          {cm.termsLink.label}
          <ArrowRight />
        </Link>
      </div>
    </section>
  );
}

/* ---------- 08 — Partner requirements ---------- */

export function PartnerRequirements({ content }: { content: PartnerPageContent }) {
  const { requirements } = content;
  const img = getPartnerImages(content.locale);

  return (
    <section className="wos-section wos-section-beige" id="requirements">
      <div className="wos-shell wos-split wos-split-reverse">
        <div className="wos-split-copy">
          <span className="wos-eyebrow">{requirements.eyebrow}</span>
          <h2 className="wos-display">{requirements.headline}</h2>
          <ul className="wos-req-list">
            {requirements.items.map((item) => (
              <li key={item}>
                <CheckMark />
                {item}
              </li>
            ))}
          </ul>
          <p className="wos-note">{requirements.note}</p>
        </div>

        <Reveal className="wos-split-media">
          <figure className="wos-figure wos-ratio-4x3">
            <Image
              src={img.step02.src}
              alt={img.step02.alt}
              fill
              sizes="(max-width: 1023px) 100vw, 45vw"
              className="wos-img"
            />
          </figure>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- 09 — Final CTA (full-bleed) ---------- */

export function PartnerCta({ content }: { content: PartnerPageContent }) {
  const { cta } = content;
  const img = getPartnerImages(content.locale);

  return (
    <section className="wos-final-cta" id="apply">
      <Image
        src={img.finalCta.src}
        alt=""
        fill
        sizes="100vw"
        aria-hidden="true"
        className="wos-img wos-final-cta-img"
      />
      <div className="wos-final-cta-scrim" />
      <div className="wos-shell wos-final-cta-content">
        <span className="wos-eyebrow">{cta.eyebrow}</span>
        <h2 className="wos-display wos-display-xl">
          <span className="wos-hero-line">{cta.headline}</span>
        </h2>
        <p className="wos-subhead">{cta.subheadline}</p>
        <p className="wos-lead">{cta.description}</p>
        <div className="wos-cta-row">
          <Link href={cta.primaryCta.href} className="wos-btn wos-btn-gold wos-btn-lg">
            {cta.primaryCta.label}
            <ArrowRight />
          </Link>
          <Link href={cta.secondaryCta.href} className="wos-btn-ghost wos-btn-ghost-light">
            {cta.secondaryCta.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
