// Business rules: Understanding + context -> Action. Pure, no I/O.
import type { CatalogItem, DetailField, Understanding } from './types';
import { detectProvinceInText, matchProvince, type ProvinceRecord } from './provinces';

export const THRESHOLDS = { high: 0.8, medium: 0.5 }; // tune from eval, then lock

export interface DecideContext {
  /** Items shown in the last list, in display order. Empty when unknown/stale. */
  recentCatalog: CatalogItem[];
  /** How many catalog rows have been shown so far for the current list (for "more"). */
  catalogOffset: number;
  /** Province + query of the list currently on screen. */
  catalogQuery: { provinceId: string | null; query: string | null } | null;
  selectedProgramId: string | null;
  journeyProvinceId: string | null;
}

export interface DecideDeps {
  provinces: ProvinceRecord[];
  coveredProvinceIds: Set<string>;
  thresholds?: { high: number; medium: number };
}

export type Action =
  | { type: 'DEFER'; reason: string } // hand over to the legacy path untouched
  | { type: 'RESET' }                 // clear stored state, then legacy handles the reset wording
  | { type: 'ASK_PROVINCE'; coveredIds: string[] }
  | { type: 'ASK_SELECTION' }
  | { type: 'ASK_CLARIFY'; item: CatalogItem | null }
  | { type: 'NO_COVERAGE'; province: ProvinceRecord; coveredIds: string[] }
  | { type: 'SEARCH'; province: ProvinceRecord | null; query: string | null; offset: number; kind: 'discovery' | 'search' | 'more' }
  | { type: 'SELECT'; index: number; item: CatalogItem }
  | { type: 'DETAIL'; item: CatalogItem; field: DetailField };

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export function confidenceLevel(c: number, t = THRESHOLDS): ConfidenceLevel {
  return c >= t.high ? 'high' : c >= t.medium ? 'medium' : 'low';
}

export function decide(
  u: Understanding,
  message: string,
  ctx: DecideContext,
  deps: DecideDeps,
): Action {
  const level = confidenceLevel(u.confidence, deps.thresholds);
  const e = u.entities;
  const covered = [...deps.coveredProvinceIds];

  // Only the program-catalog family is handled here. Everything else (greeting, hotel,
  // transport, concierge/handoff journey, FAQ) stays on the legacy path untouched.
  if (u.intent === 'RESET') return { type: 'RESET' };
  const catalogFamily = ['PROGRAM_DISCOVERY', 'PROGRAM_SEARCH', 'PROGRAM_MORE', 'PROGRAM_SELECTION', 'PROGRAM_DETAIL'];
  if (!catalogFamily.includes(u.intent)) return { type: 'DEFER', reason: `intent_${u.intent.toLowerCase()}` };
  if (level === 'low') return { type: 'DEFER', reason: 'low_confidence' };

  // Province: the model's value must exist in canonical data; text match is a deterministic backup.
  const fromModel = matchProvince(e.province, deps.provinces);
  const fromText = detectProvinceInText(message, deps.provinces);
  const province = fromModel ?? fromText;
  const namedButUnknown = !!e.province && !fromModel && !fromText;

  switch (u.intent) {
    case 'PROGRAM_DISCOVERY':
    case 'PROGRAM_SEARCH': {
      if (namedButUnknown) return { type: 'ASK_PROVINCE', coveredIds: covered };
      const inherited =
        !province && u.uses_context && u.intent === 'PROGRAM_SEARCH' && ctx.journeyProvinceId
          ? deps.provinces.find((p) => p.id === ctx.journeyProvinceId) ?? null
          : null;
      const prov = province ?? inherited;
      const query = u.intent === 'PROGRAM_SEARCH' ? e.program_query : null;
      if (prov && !deps.coveredProvinceIds.has(prov.id)) return { type: 'NO_COVERAGE', province: prov, coveredIds: covered };
      if (!prov && !query) return { type: 'ASK_PROVINCE', coveredIds: covered };
      return { type: 'SEARCH', province: prov, query, offset: 0, kind: u.intent === 'PROGRAM_SEARCH' ? 'search' : 'discovery' };
    }

    case 'PROGRAM_MORE': {
      if (ctx.recentCatalog.length === 0 || !ctx.catalogQuery) return { type: 'DEFER', reason: 'no_catalog_context' };
      const prov = ctx.catalogQuery.provinceId ? deps.provinces.find((p) => p.id === ctx.catalogQuery!.provinceId) ?? null : null;
      return { type: 'SEARCH', province: prov, query: ctx.catalogQuery.query, offset: ctx.catalogOffset, kind: 'more' };
    }

    case 'PROGRAM_SELECTION': {
      if (ctx.recentCatalog.length === 0) return { type: 'DEFER', reason: 'no_catalog_context' };
      const i = e.selection_index;
      const item = i != null ? ctx.recentCatalog[i] : undefined;
      if (!item || i == null) return { type: 'ASK_SELECTION' };
      if (level === 'medium' && !u.uses_context) return { type: 'ASK_CLARIFY', item };
      return { type: 'SELECT', index: i, item };
    }

    case 'PROGRAM_DETAIL': {
      if (ctx.recentCatalog.length === 0) return { type: 'DEFER', reason: 'no_catalog_context' };
      const byIndex = e.selection_index != null ? ctx.recentCatalog[e.selection_index] : undefined;
      const selected = ctx.selectedProgramId ? ctx.recentCatalog.find((c) => c.id === ctx.selectedProgramId) : undefined;
      const item = byIndex ?? selected ?? (ctx.recentCatalog.length === 1 ? ctx.recentCatalog[0] : undefined);
      if (!item) return { type: 'ASK_SELECTION' };
      const field = e.detail_field ?? 'other';
      // Booking/requirements/location flows live in the legacy concierge journey.
      if (field === 'booking' || field === 'requirements' || field === 'location') return { type: 'DEFER', reason: `detail_${field}` };
      if (level === 'medium' && !u.uses_context && !byIndex && !selected) return { type: 'ASK_CLARIFY', item };
      return { type: 'DETAIL', item, field };
    }
  }
  return { type: 'DEFER', reason: 'unhandled' };
}

/** A stored catalog is only trusted if the last assistant message actually shows it (the legacy path may have replied since). */
export function catalogMatchesHistory(catalog: CatalogItem[], history: { role: string; content: string }[]): boolean {
  if (catalog.length === 0) return false;
  const last = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  return catalog.every((c) => last.includes(c.title.trim()));
}
