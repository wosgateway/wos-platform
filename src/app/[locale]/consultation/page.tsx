'use client';

// src/app/[locale]/consultation/page.tsx
//
// Phase 1 of "ปรึกษา WOS ฟรี" — the public form that POSTs to
// /api/consultation (Phase 2, already live — see that route's header
// comment). Before this page existed, that API had no way to be
// reached by a real visitor; this closes the loop.
//
// Pattern follows src/app/[locale]/my-trip/page.tsx: a client
// component using next-intl's useTranslations for copy, plain
// .form-input/.form-label/.btn-primary classes (the main-site form
// convention — see globals.css), and fetch + local state instead of
// a form library (none is used anywhere else in this app).
//
// language: next-intl's locale codes ('th' | 'lo' | 'en', see
// src/i18n/routing.ts) are the exact same set the API validates
// against (LANGUAGES in route.ts), so it's forwarded as-is with no
// mapping.
//
// source / utm_*: read from the query string so links into this page
// (homepage CTA — Phase 3, not built yet; partner pages; ads) can tag
// where a lead came from. Falls back to 'unknown' — the same default
// the API itself uses — when absent or not one of the allowed values,
// so a malformed/spoofed ?source= never reaches the API rather than
// getting rejected there.

import { useState, FormEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';

const CONTACT_CHANNELS = ['phone', 'whatsapp', 'line', 'email', 'other'] as const;
const REQUEST_TYPES = [
  'health_checkup',
  'medical_treatment',
  'dental',
  'wellness',
  'aesthetic',
  'hospital_clinic',
  'hotel',
  'transport',
  'not_sure',
] as const;
const TRAVEL_PERIODS = [
  'unspecified',
  'within_1_month',
  '1_to_3_months',
  'more_than_3_months',
] as const;
// Keep in sync with SOURCES in src/app/api/consultation/route.ts — this
// is only used to validate an incoming ?source= query param, not to
// invent new values.
const SOURCES = [
  'homepage_hero',
  'homepage_bottom',
  'partner_page',
  'package_page',
  'knowledge_center',
  'unknown',
] as const;
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;

type ContactChannel = (typeof CONTACT_CHANNELS)[number];
type RequestType = (typeof REQUEST_TYPES)[number];
type TravelPeriod = (typeof TRAVEL_PERIODS)[number];

interface FormState {
  name: string;
  contactChannel: ContactChannel | '';
  contactValue: string;
  country: '' | 'Laos' | 'Thailand' | 'Other';
  requestTypes: RequestType[];
  message: string;
  travelPeriod: TravelPeriod;
}

const initialForm: FormState = {
  name: '',
  contactChannel: '',
  contactValue: '',
  country: '',
  requestTypes: [],
  message: '',
  travelPeriod: 'unspecified',
};

export default function ConsultationPage() {
  const t = useTranslations('consultation');
  const locale = useLocale();
  const searchParams = useSearchParams();

  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleRequestType(type: RequestType) {
    setForm((prev) => ({
      ...prev,
      requestTypes: prev.requestTypes.includes(type)
        ? prev.requestTypes.filter((t) => t !== type)
        : [...prev.requestTypes, type],
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const name = form.name.trim();
    if (!name) {
      setError(t('errors.name'));
      return;
    }
    if (!form.contactChannel) {
      setError(t('errors.contactChannel'));
      return;
    }
    const contactValue = form.contactValue.trim();
    if (contactValue.length < 3) {
      setError(t('errors.contactValue'));
      return;
    }
    if (!form.country) {
      setError(t('errors.country'));
      return;
    }
    if (form.requestTypes.length === 0) {
      setError(t('errors.requestTypes'));
      return;
    }

    const source = SOURCES.includes(searchParams.get('source') as (typeof SOURCES)[number])
      ? (searchParams.get('source') as (typeof SOURCES)[number])
      : 'unknown';

    const utm = Object.fromEntries(
      UTM_PARAMS.map((key) => [key, searchParams.get(key) || undefined])
    );

    setSubmitting(true);
    try {
      const res = await fetch('/api/consultation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: locale,
          name,
          contact_channel: form.contactChannel,
          contact_value: contactValue,
          country: form.country,
          request_types: form.requestTypes,
          message: form.message.trim() || undefined,
          travel_period: form.travelPeriod,
          source,
          ...utm,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setError(result?.error || t('errors.generic'));
        return;
      }

      setSubmitted(true);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold mb-2">{t('success.title')}</h1>
        <p className="text-slate-500 mb-8">{t('success.description')}</p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setForm(initialForm);
            setSubmitted(false);
          }}
        >
          {t('success.another')}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <div className="text-center mb-10">
        <span className="text-sm font-medium text-primary">{t('eyebrow')}</span>
        <h1 className="text-3xl font-semibold mt-2 mb-3">{t('title')}</h1>
        <p className="text-slate-500">{t('description')}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="form-label" htmlFor="consultation-name">
            {t('fields.name')} *
          </label>
          <input
            id="consultation-name"
            type="text"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder={t('fields.namePlaceholder')}
            className="form-input"
            autoComplete="name"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label" htmlFor="consultation-contact-channel">
              {t('fields.contactChannel')} *
            </label>
            <select
              id="consultation-contact-channel"
              className="form-input"
              value={form.contactChannel}
              onChange={(e) => update('contactChannel', e.target.value as FormState['contactChannel'])}
            >
              <option value="">{t('fields.select')}</option>
              {CONTACT_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {t(`fields.contactChannelOptions.${channel}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="consultation-contact-value">
              {t('fields.contactValue')} *
            </label>
            <input
              id="consultation-contact-value"
              type="text"
              value={form.contactValue}
              onChange={(e) => update('contactValue', e.target.value)}
              placeholder={t('fields.contactValuePlaceholder')}
              className="form-input"
              autoComplete="tel"
            />
          </div>
        </div>

        <div>
          <label className="form-label" htmlFor="consultation-country">
            {t('fields.country')} *
          </label>
          <select
            id="consultation-country"
            className="form-input"
            value={form.country}
            onChange={(e) => update('country', e.target.value as FormState['country'])}
          >
            <option value="">{t('fields.select')}</option>
            <option value="Laos">Laos / ลาว / ລາວ</option>
            <option value="Thailand">Thailand / ไทย / ໄທ</option>
            <option value="Other">{t('fields.other')}</option>
          </select>
        </div>

        <div>
          <span className="form-label">{t('fields.requestTypes')} *</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
            {REQUEST_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.requestTypes.includes(type)}
                  onChange={() => toggleRequestType(type)}
                />
                {t(`fields.requestTypeOptions.${type}`)}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="form-label" htmlFor="consultation-travel-period">
            {t('fields.travelPeriod')}
          </label>
          <select
            id="consultation-travel-period"
            className="form-input"
            value={form.travelPeriod}
            onChange={(e) => update('travelPeriod', e.target.value as TravelPeriod)}
          >
            {TRAVEL_PERIODS.map((period) => (
              <option key={period} value={period}>
                {t(`fields.travelPeriodOptions.${period}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label" htmlFor="consultation-message">
            {t('fields.message')}
          </label>
          <textarea
            id="consultation-message"
            value={form.message}
            onChange={(e) => update('message', e.target.value)}
            placeholder={t('fields.messagePlaceholder')}
            className="form-input min-h-[120px] resize-y"
            maxLength={2000}
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? t('fields.submitting') : t('fields.submit')}
        </button>
      </form>
    </main>
  );
}
