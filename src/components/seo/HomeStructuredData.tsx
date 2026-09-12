const SITE_URL = 'https://wos.asia';

type HomeStructuredDataProps = {
  locale: string;
};

const LOCALE_PATHS: Record<string, string> = {
  th: '/th',
  lo: '/lo',
  en: '/en',
};

const PAGE_NAMES: Record<string, string> = {
  th: 'WOS \u2014 \u0e41\u0e1e\u0e25\u0e15\u0e1f\u0e2d\u0e23\u0e4c\u0e21\u0e2a\u0e38\u0e02\u0e20\u0e32\u0e1e\u0e41\u0e25\u0e30\u0e40\u0e27\u0e25\u0e40\u0e19\u0e2a\u0e44\u0e17\u0e22\u2013\u0e25\u0e32\u0e27',
  lo: 'WOS \u2014 \u0ec0\u0e9e\u0ea5\u0eb1\u0e94\u0e9f\u0ead\u0ea3\u0eb0\u0e9a\u0ebb\u0e9a\u0eaa\u0eb8\u0e82\u0eb0\u0e9e\u0eb2\u0e9a \u0ec1\u0ea5\u0eb0 Wellness \u0ec4\u0e97\u2013\u0ea5\u0eb2\u0ea7',
  en: 'WOS \u2014 Thailand\u2013Laos Cross-Border Wellness & Healthcare',
};

export function HomeStructuredData({
  locale,
}: HomeStructuredDataProps) {
  const localePath = LOCALE_PATHS[locale] ?? '/th';
  const pageUrl = `${SITE_URL}${localePath}`;
  const pageName = PAGE_NAMES[locale] ?? PAGE_NAMES.en;

  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}/#webpage`,
        url: pageUrl,
        name: pageName,
        isPartOf: {
          '@id': `${SITE_URL}/#website`,
        },
        about: {
          '@id': `${SITE_URL}/#organization`,
        },
        mainEntity: {
          '@id': `${SITE_URL}/#organization`,
        },
        inLanguage: locale,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data),
      }}
    />
  );
}
