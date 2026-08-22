// app/[locale]/partner/page.tsx
import type { Metadata } from "next";
import { getPartnerContent, partnerLocales } from "@/content/partner";
import {
  PartnerHero,
  FoundingPartner,
  WhyPartner,
  PartnerTypes,
  HowItWorks,
  OperatingModel,
  Benefits,
  CommercialTermsSection,
  MouSection,
  ResponsibilitiesSlaSection,
  PreparePartner,
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
      <PartnerHero content={content} />
      <FoundingPartner content={content} />
      <WhyPartner content={content} />
      <PartnerTypes content={content} />
      <HowItWorks content={content} />
      <OperatingModel content={content} />
      <Benefits content={content} />
      <CommercialTermsSection content={content} />
      <MouSection content={content} />
      <ResponsibilitiesSlaSection content={content} />
      <PreparePartner content={content} />
      <PartnerCta content={content} />
    </main>
  );
}
