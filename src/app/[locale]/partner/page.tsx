// app/[locale]/partner/page.tsx
//
// Partner landing page v2 — see the redesign brief.
// Nine sections, one primary CTA ("Become a Founding Partner"), everything
// contractual (SLA, commission, settlement, MOU detail) moved to
// /partner/terms so an undecided partner never has to read it here.

import type { Metadata } from "next";
import { getPartnerContent, partnerLocales } from "@/content/partner";
import { PartnerNav } from "@/components/partner/PartnerNav";
import {
  PartnerHero,
  WhyPartner,
  JourneySection,
  WhoCanJoin,
  FoundingPartner,
  HowItWorks,
  CommercialModel,
  PartnerRequirements,
  PartnerCta,
} from "@/components/partner/sections";
import "./partner-theme.css";

interface PageProps {
  params: { locale: string };
}

export function generateStaticParams() {
  return partnerLocales.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: PageProps): Metadata {
  const content = getPartnerContent(params.locale);
  return {
    title: content.seo.title,
    description: content.seo.description,
    keywords: content.seo.keywords,
  };
}

export default function PartnerPage({ params }: PageProps) {
  const content = getPartnerContent(params.locale);

  return (
    <main className="wos-partner">
      <PartnerNav nav={content.nav} />
      <PartnerHero content={content} />
      <WhyPartner content={content} />
      <JourneySection content={content} />
      <WhoCanJoin content={content} />
      <FoundingPartner content={content} />
      <HowItWorks content={content} />
      <CommercialModel content={content} />
      <PartnerRequirements content={content} />
      <PartnerCta content={content} />
    </main>
  );
}
