// content/partner/types.ts
// Shape of the /partner page content. One object per locale (th / en / lo).
// Sourced from the WOS partner content package, restructured to also cover
// Partnership Process, Commercial Terms, MOU/Agreement and Responsibilities & SLA,
// which the original export did not include.

export type Locale = "th" | "en" | "lo";

export interface HeroContent {
  eyebrow: string;
  headline: string;
  subheadline: string;
  ctaText: string;
  ctaLink: string;
  boardingLabel: string; // small "ticket" label, e.g. "PARTNER PASS"
}

export interface Reason {
  code: string; // short 2-3 letter code, ticket-stub style, e.g. "ACC"
  title: string;
  description: string;
  icon: string;
}

export interface PartnerType {
  code: string; // e.g. "HSP", "CLN", "HTL", "TRN", "COR"
  name: string;
  icon: string;
  description: string;
  subTypes: string[];
  requirements: string[];
}

export interface Step {
  stepNumber: number;
  title: string;
  description: string;
  duration: string;
}

export interface OperatingModel {
  headline: string;
  flowSteps: string[]; // parsed from the arrow-separated flow string
  keyPoints: string[];
}

export interface Benefit {
  title: string;
  description: string;
  icon: string;
  features: string[];
}

export interface CommercialTerm {
  label: string;
  value: string;
  note?: string;
}

export interface CommercialTerms {
  headline: string;
  intro: string;
  docStamp: string; // small stamp label on the terms card, e.g. "Founding Partner Terms"
  terms: CommercialTerm[];
  disclaimer: string;
}

/** "WOS Founding Partner Program" callout, shown right after the hero. */
export interface FoundingPartnerSection {
  eyebrow: string;
  headline: string;
  intro: string;
  benefitsHeadline: string;
  benefits: string[];
}

/** Phase 1 focus note shown alongside Partner Types (sales focus, not a hard restriction). */
export interface PhaseFocus {
  label: string;
  headline: string;
  description: string;
}

/** "What partners need to prepare" checklist, shown before the closing CTA. */
export interface PrepareSection {
  eyebrow: string;
  headline: string;
  items: string[];
  ctaText: string;
  ctaLink: string;
}

export interface MouSection {
  headline: string;
  intro: string;
  documentIncludes: string[];
  signingSteps: string[];
  downloadLabel: string;
  downloadNote: string;
}

export interface ResponsibilityRow {
  area: string;
  wos: string;
  partner: string;
}

export interface SlaItem {
  label: string;
  target: string;
}

export interface ResponsibilitiesSla {
  headline: string;
  intro: string;
  responsibilities: ResponsibilityRow[];
  slaHeadline: string;
  slaItems: SlaItem[];
}

export interface CtaSection {
  headline: string;
  subtext: string;
  buttonText: string;
  buttonLink: string;
  gateLabel: string; // "boarding gate" style micro-copy
}

export interface Seo {
  title: string;
  description: string;
  keywords: string[];
}

export interface ApplyFormContent {
  eyebrow: string;
  headline: string;
  subheadline: string;
  sections: {
    company: string;
    contact: string;
    services: string;
    consent: string;
  };
  fields: {
    companyName: string;
    registrationNumber: string;
    taxId: string;
    businessType: string;
    businessTypeOptions: { value: string; label: string }[];
    yearEstablished: string;
    employeeCount: string;
    primaryName: string;
    primaryTitle: string;
    primaryEmail: string;
    primaryPhone: string;
    primaryLineId: string;
    address: string;
    district: string;
    province: string;
    postalCode: string;
    serviceTypes: string;
    languages: string;
    operatingHours: string;
    capacity: string;
  };
  consent: {
    acceptTerms: string;
    acceptPrivacy: string;
    acceptSLA: string;
  };
  submitLabel: string;
  submittingLabel: string;
  successTitle: string;
  successBody: string;
  errorTitle: string;
  errorBody: string;
}

export interface PartnerPageContent {
  locale: Locale;
  hero: HeroContent;
  foundingPartner: FoundingPartnerSection;
  whyPartner: { headline: string; reasons: Reason[] };
  partnerTypes: PartnerType[];
  phaseFocus: PhaseFocus;
  howItWorks: Step[];
  operatingModel: OperatingModel;
  benefits: Benefit[];
  commercialTerms: CommercialTerms;
  mou: MouSection;
  responsibilitiesSla: ResponsibilitiesSla;
  prepare: PrepareSection;
  cta: CtaSection;
  seo: Seo;
  applyForm: ApplyFormContent;
}
