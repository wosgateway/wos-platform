import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ calls: [] as unknown[][], result: [] as unknown[] }));
vi.mock('@/lib/supabase/server', () => ({
  createAnonClient: () => {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'select', 'eq', 'in', 'order', 'limit', 'single']) {
      chain[method] = (...args: unknown[]) => { mock.calls.push([method, ...args]); return chain; };
    }
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: mock.result, error: null });
    return { ...chain, rpc: (...args: unknown[]) => {
      mock.calls.push(['rpc', ...args]); return Promise.resolve({ data: mock.result, error: null });
    } };
  },
}));
import { fetchFeaturedPackages, fetchPackagesByPartner, searchPackages } from './data';

describe('canonical catalog application boundary', () => {
  beforeEach(() => { mock.calls = []; mock.result = []; });
  it('uses canonical promotion filter and legacy read projection for featured catalog', async () => {
    await fetchFeaturedPackages();
    expect(mock.calls).toContainEqual(['eq', 'promotion', true]);
    expect(mock.calls.some(call => call[0] === 'select' && String(call[1]).includes('is_promotion:promotion'))).toBe(true);
    expect(mock.calls).not.toContainEqual(['eq', 'is_promotion', true]);
  });
  it('projects promotion compatibility for partner catalog too', async () => {
    await fetchPackagesByPartner('synthetic-partner', true);
    expect(mock.calls).toContainEqual(['select', '*, is_promotion:promotion']);
    expect(mock.calls).toContainEqual(['eq', 'promotion', true]);
  });
  it.each([60, 0, null])('keeps RPC integer-minute value %s unchanged', async duration => {
    mock.result = [{ id: 'synthetic-package', title: 'Synthetic', duration, is_promotion: true }];
    const rows = await searchPackages('Synthetic', 10);
    expect(rows[0].duration).toBe(duration);
    expect(rows[0].is_promotion).toBe(true);
  });
});

// Compatibility consumers receive the existing output property, not a stored legacy field.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgramCardV2 } from '@/components/ProgramCardV2';
import { buildProgramPriceAnswer } from '@/lib/ai/program-answer';
import type { Package } from './data';
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({ Link: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/journey/AddToJourneyButton', () => ({ AddToJourneyButton: () => null }));
describe('search output compatibility consumers', () => {
  it.each([true, false])('UI and AI consume is_promotion=%s', async flag => {
    vi.stubGlobal('React', React);
    try {
      mock.result = [{ id: 'fixture', title: 'Program', duration: null, is_promotion: flag, original_price: 100, special_price: 80 }];
      const [row] = await searchPackages('Program', 10);
      expect(mock.calls).toContainEqual(['rpc', 'search_packages_thai', { search_term: 'Program', result_limit: 10 }]);
      expect(row.is_promotion).toBe(flag);
      expect(row).not.toHaveProperty('promotion');
      const html = renderToStaticMarkup(React.createElement(ProgramCardV2, { pkg: row as unknown as Package }));
      expect(html.includes('🔥')).toBe(flag);
      const answer = buildProgramPriceAnswer({ title: typeof row.title === 'string' ? row.title : undefined, is_promotion: typeof row.is_promotion === 'boolean' ? row.is_promotion : undefined, original_price: typeof row.original_price === 'number' ? row.original_price : null, special_price: typeof row.special_price === 'number' ? row.special_price : null }, 'price', '', 'en');
      expect(answer?.includes('promotional price')).toBe(flag);
    } finally { vi.unstubAllGlobals(); }
  });
});
