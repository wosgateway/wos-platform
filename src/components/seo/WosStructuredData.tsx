const SITE_URL = 'https://wos.asia';

const data = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'WOS',
      legalName: 'WOS (Wellness Operating System)',
      alternateName: [
        'WOS ASIA',
        'WOS Thailand Healthcare',
      ],
      url: SITE_URL,
      description:
        'Thailand\u2013Laos cross-border wellness and healthcare operating platform connecting customers from Lao PDR with selected healthcare, wellness and recovery providers in Thailand.',
      areaServed: [
        {
          '@type': 'Country',
          name: 'Laos',
        },
        {
          '@type': 'Country',
          name: 'Thailand',
        },
      ],
      knowsLanguage: ['lo', 'th', 'en'],
    },

    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'WOS',
      publisher: {
        '@id': `${SITE_URL}/#organization`,
      },
      inLanguage: ['lo', 'th', 'en'],
    },

    {
      '@type': 'Service',
      '@id': `${SITE_URL}/#cross-border-service`,
      name:
        'Thailand\u2013Laos Cross-Border Wellness & Healthcare Services',
      serviceType: [
        'Cross-border healthcare coordination',
        'Wellness programs',
        'Health screening',
        'Aesthetic and wellness services',
        'Recovery and self-care programs',
      ],
      provider: {
        '@id': `${SITE_URL}/#organization`,
      },
      areaServed: [
        {
          '@type': 'Country',
          name: 'Laos',
        },
        {
          '@type': 'Country',
          name: 'Thailand',
        },
      ],
      description:
        'WOS connects customers from Lao PDR with selected healthcare, wellness and recovery providers in Thailand and coordinates the customer journey across services, appointments, travel and related support.',
    },
  ],
};

export function WosStructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data),
      }}
    />
  );
}
