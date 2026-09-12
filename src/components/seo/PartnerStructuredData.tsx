const SITE_URL = 'https://wos.asia';

type PartnerStructuredDataProps = {
  locale: string;
  partner: {
    id: string;
    name: string;
    category: string;
    province?: string | null;
    description?: string | null;
    cover_image_url?: string | null;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    location_status?: string | null;
  };
};

function getPartnerSchemaType(category: string) {
  const value = category.toLowerCase();

  if (
    value.includes('hospital') ||
    value.includes('\u0e42\u0e23\u0e07\u0e1e\u0e22\u0e32\u0e1a\u0e32\u0e25') ||
    value.includes('\u0eaa\u0eb0\u0e96\u0eb2\u0e99\u0e9e\u0eb0\u0e8d\u0eb2\u0e9a\u0eb2\u0e99')
  ) {
    return 'Hospital';
  }

  if (
    value.includes('clinic') ||
    value.includes('\u0e04\u0e25\u0e34\u0e19\u0e34\u0e01') ||
    value.includes('\u0e84\u0eb9\u0e99\u0eb4\u0e81')
  ) {
    return 'MedicalClinic';
  }

  if (
    value.includes('wellness') ||
    value.includes('spa') ||
    value.includes('\u0e2a\u0e1b\u0e32') ||
    value.includes('\u0e40\u0e27\u0e25\u0e40\u0e19\u0e2a')
  ) {
    return 'HealthAndBeautyBusiness';
  }

  return 'LocalBusiness';
}

export function PartnerStructuredData({
  locale,
  partner,
}: PartnerStructuredDataProps) {
  const pageUrl = `${SITE_URL}/${locale}/partners/${partner.id}`;
  const entityType = getPartnerSchemaType(partner.category);

  const hasVerifiedGeo =
    partner.location_status === 'verified' &&
    typeof partner.latitude === 'number' &&
    typeof partner.longitude === 'number';

  const partnerEntity: Record<string, unknown> = {
    '@type': entityType,
    '@id': `${pageUrl}/#partner`,
    name: partner.name,
    url: pageUrl,
  };

  if (partner.description) {
    partnerEntity.description = partner.description;
  }

  if (partner.cover_image_url) {
    partnerEntity.image = partner.cover_image_url;
  }

  if (partner.address || partner.province) {
    partnerEntity.address = {
      '@type': 'PostalAddress',
      ...(partner.address ? { streetAddress: partner.address } : {}),
      ...(partner.province ? { addressRegion: partner.province } : {}),
      addressCountry: 'TH',
    };
  }

  if (hasVerifiedGeo) {
    partnerEntity.geo = {
      '@type': 'GeoCoordinates',
      latitude: partner.latitude,
      longitude: partner.longitude,
    };
  }

  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}/#webpage`,
        url: pageUrl,
        name: partner.name,
        isPartOf: {
          '@id': `${SITE_URL}/#website`,
        },
        about: {
          '@id': `${pageUrl}/#partner`,
        },
        mainEntity: {
          '@id': `${pageUrl}/#partner`,
        },
        inLanguage: locale,
      },
      partnerEntity,
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
