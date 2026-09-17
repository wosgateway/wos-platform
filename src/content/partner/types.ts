// content/partner/types.ts
//
// Shape of the /partner page content. One object per locale (th / en / lo).
//
// Redesign note (Partner Page v2):
// The landing page is now a 9-section "sell the partnership" page — Hero,
// Why Partner, One Complete Journey, Who Can Join, Founding Partner,
// How It Works, Commercial Model, Requirements, Final CTA.
// The detailed commercial / MOU / SLA content has NOT been deleted: it moved
// to the supporting page at /partner/terms and still lives in
// `commercialTerms`, `mou` and `responsibilitiesSla` below.

export type Locale = "th" | "en" | "lo";

export interface CtaLink {
  label: string;
  href: string;
}

/** Sticky in-page nav on /partner. */
export interface PartnerNavContent {
  brand: string;
  mobileBrand: string;
  links: { label: string; href: string }[];
  cta: CtaLink;
  mobileCtaLabel: string;
}

export interface HeroContent {
  eyebrow: string;
  /** Rendered as separate lines so the mobile hero breaks exactly where intended. */
  headlineLines: string[];
  description: string;
  highlight: string;
  primaryCta: CtaLink;
  secondaryCta: CtaLink;
  /** Short labels for the Laos -> WOS -> Thailand visual. */
  visual: { from: string; via: string; to: string };
}

export interface ValueCard {
  index: string; // "01" | "02" | "03"
  title: string;
  description: string;
}

export interface WhyPartnerSection {
  eyebrow: string;
  headline: string;
  subheadline: string;
  cards: ValueCard[];
}

export interface JourneyStep {
  index: string; // "01" ... "05"
  title: string;
  description: string;
}

export interface JourneySection {
  eyebrow: string;
  headline: string;
  subheadline: string;
  steps: JourneyStep[];
  highlightTitle: string;
  highlightText: string;
}

export interface PartnerGroup {
  name: string;
  items: string[];
}

export interface WhoCanJoinSection {
  eyebrow: string;
  headline: string;
  intro: string;
  groups: PartnerGroup[];
  note: string;
}

export interface FoundingPrivilege {
  title: string;
  description: string;
}

export interface FoundingPartnerSection {
  eyebrow: string;
  headline: string;
  intro: string;
  privilegesHeadline: string;
  privileges: FoundingPrivilege[];
  badge: string;
  cta: CtaLink;
}

export interface ProcessStep {
  index: string; // "01" ... "04"
  title: string;
  description: string;
}

export interface HowItWorksSection {
  eyebrow: string;
  headline: string;
  steps: ProcessStep[];
  ctaHeadline: string;
  cta: CtaLink;
}

export interface CommercialCard {
  /** Big editorial word: "NO" / "NO" / "PAY". */
  lead: string;
  /** The term it qualifies: "SETUP FEE" / "MONTHLY FEE" / "WHEN BUSINESS HAPPENS". */
  term: string;
  note: string;
}

export interface CommercialModelSection {
  eyebrow: string;
  headline: string;
  subheadline: string;
  cards: CommercialCard[];
  termsLink: CtaLink;
}

export interface RequirementsSection {
  eyebrow: string;
  headline: string;
  items: string[];
  note: string;
}

export interface CtaSection {
  eyebrow: string;
  headline: string;
  subheadline: string;
  description: string;
  primaryCta: CtaLink;
  secondaryCta: CtaLink;
}

/** Copy for the supporting page at /partner/terms. */
export interface TermsPageContent {
  eyebrow: string;
  headline: string;
  intro: string;
  backLabel: string;
  ctaHeadline: string;
  cta: CtaLink;
}

export interface CommercialTerm {
  label: string;
  value: string;
  note?: string;
}

export interface FeeScheduleItem {
  icon: string;
  category: string;
  fee: string; // e.g. "15%" or "20%+"
  principle: string; // short note on how the fee is calculated
}

export interface CommercialTerms {
  headline: string;
  intro: string;
  docStamp: string;
  terms: CommercialTerm[];
  feeScheduleHeadline: string;
  feeSchedule: FeeScheduleItem[];
  feeScheduleNote: string;
  disclaimer: string;
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
  validationError: string;
}

export interface PartnerPageContent {
  locale: Locale;
  nav: PartnerNavContent;
  hero: HeroContent;
  whyPartner: WhyPartnerSection;
  journey: JourneySection;
  whoCanJoin: WhoCanJoinSection;
  foundingPartner: FoundingPartnerSection;
  howItWorks: HowItWorksSection;
  commercialModel: CommercialModelSection;
  requirements: RequirementsSection;
  cta: CtaSection;
  /** Supporting page only — not rendered on the landing page. */
  termsPage: TermsPageContent;
  commercialTerms: CommercialTerms;
  mou: MouSection;
  responsibilitiesSla: ResponsibilitiesSla;
  seo: Seo;
  applyForm: ApplyFormContent;
}
