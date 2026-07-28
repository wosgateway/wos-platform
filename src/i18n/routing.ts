import { defineRouting } from 'next-intl/routing';

// Old site used data-lang="th|lo|en" spans toggled by JS (invisible to Google).
// This makes each language a real indexable URL instead: /th/..., /lo/..., /en/...
export const routing = defineRouting({
  locales: ['th', 'lo', 'en'],
  defaultLocale: 'th',
});
