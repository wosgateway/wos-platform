// app/[locale]/partner/apply/page.tsx
import type { Metadata } from "next";
import { getPartnerContent, partnerLocales } from "@/content/partner";
import { ApplyForm } from "./ApplyForm";
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
    title: content.applyForm.headline,
    description: content.applyForm.subheadline,
  };
}

export default function PartnerApplyPage({ params }: PageProps) {
  const content = getPartnerContent(params.locale);

  return (
    <main className="wos-partner">
      <section className="wos-section wos-hero" style={{ paddingBottom: 0 }}>
        <div className="wos-shell">
          <span className="wos-eyebrow">{content.applyForm.eyebrow}</span>
          <h1 className="wos-display" style={{ fontSize: "clamp(28px, 3.6vw, 40px)" }}>
            {content.applyForm.headline}
          </h1>
          <p style={{ color: "var(--wos-ink-soft)", maxWidth: "56ch" }}>{content.applyForm.subheadline}</p>
        </div>
      </section>

      <section className="wos-section">
        <div className="wos-shell" style={{ maxWidth: 760 }}>
          <ApplyForm content={content} />
        </div>
      </section>
    </main>
  );
}
