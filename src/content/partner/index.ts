// content/partner/index.ts
import { th } from "./th";
import { en } from "./en";
import { lo } from "./lo";
import type { Locale, PartnerPageContent } from "./types";

const dictionaries: Record<Locale, PartnerPageContent> = { th, en, lo };

export function getPartnerContent(locale: string): PartnerPageContent {
  return dictionaries[(locale as Locale) in dictionaries ? (locale as Locale) : "en"];
}

export const partnerLocales: Locale[] = ["th", "en", "lo"];

export * from "./types";
