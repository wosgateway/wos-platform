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
