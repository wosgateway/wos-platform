import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ duration: null as number | null, hook: 0 }));
const fixture = () => ({
  id: 'synthetic', title: 'Synthetic package', duration: state.duration,
  original_price: 10, special_price: null, status: 'published',
  is_active: true, is_promotion: false, image_url: null,
  created_at: '2026-01-01T00:00:00Z', gallery_urls: [], amenities: [],
});
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => {
    const hook = state.hook++;
    return actual.useState(hook === 0 ? [fixture()] : hook === 1 ? false : initial);
  } };
});
vi.mock('@/lib/data', () => ({ fetchPackageById: async () => fixture() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'th', getTranslations: async () => (key: string) => key,
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/i18n/navigation', () => ({ Link: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/Breadcrumb', () => ({ Breadcrumb: () => null }));
vi.mock('@/components/journey/AddToJourneyButton', () => ({ AddToJourneyButton: () => null }));
import ProgramDetailPage from '@/app/[locale]/program/[id]/page';
import { PackagesManager } from '@/components/partner/PackagesManager';

describe('actual duration presentation boundaries', () => {
  beforeEach(() => { state.hook = 0; vi.stubGlobal('React', React); });
  it.each([0, 60, null])('program detail renders %s minutes deliberately', async duration => {
    state.duration = duration;
    const html = renderToStaticMarkup(await ProgramDetailPage({ params: { id: 'synthetic' } }));
    if (duration === null) expect(html).not.toContain('⏱️');
    else expect(html).toContain(`${duration} นาที`);
  });
  it.each([0, 60, null])('partner manager renders %s without bare zero', duration => {
    state.duration = duration;
    const html = renderToStaticMarkup(<PackagesManager partnerId="synthetic" organizationId="synthetic" partnerCategory={null} />);
    if (duration === null) expect(html).not.toContain('⏱️');
    else expect(html).toContain(`${duration} นาที`);
  });
});
