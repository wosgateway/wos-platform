import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getHeader } = vi.hoisted(() => ({
  getHeader: vi.fn<() => { get: (name: string) => string | null }>(),
}));

vi.mock('next/headers', () => ({
  headers: () => getHeader(),
}));

vi.mock('./globals.css', () => ({}));

import RootLayout from './layout';

describe('RootLayout html language', () => {
  beforeEach(() => {
    getHeader.mockReset();
  });

  it.each(['th', 'lo', 'en'])('renders the initial html lang for %s', (locale) => {
    getHeader.mockReturnValue({ get: (name) => name === 'x-wos-locale' ? locale : null });

    const html = renderToStaticMarkup(createElement(
      RootLayout,
      null,
      createElement('main', null, 'WOS')
    ));

    expect(html).toContain(`<html lang="${locale}">`);
  });

  it.each([null, 'fr', 'invalid'])('falls back to Thai for unsupported locale %s', (locale) => {
    getHeader.mockReturnValue({ get: (name) => name === 'x-wos-locale' ? locale : null });

    const html = renderToStaticMarkup(createElement(
      RootLayout,
      null,
      createElement('main', null, 'WOS')
    ));

    expect(html).toContain('<html lang="th">');
  });
});
