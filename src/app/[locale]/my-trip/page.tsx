'use client';

// src/app/[locale]/my-trip/page.tsx
//
// Order-number + phone lookup form. Header.tsx's "My Trip" nav entry
// has pointed at this bare /my-trip path since it was added, but this
// file never existed — every visit 404'd. This is that missing page.
//
// Why phone number, not just order_number: order_number alone is a
// predictable sequence (see authorize-order.ts), so a lookup that
// only asked for it would let anyone iterate WOS-20260101-00001,
// 00002, ... and view strangers' trip details. Phone number is the
// second factor the customer already knows from booking. See
// api/my-trip/lookup/route.ts for the matching/rate-limit logic.
//
// On success, the API returns the order's payment_access_token and
// this page redirects (locale-aware) to
// /my-trip/[orderNumber]?token=... — the same URL shape as the link
// sent via WhatsApp/LINE, so everything downstream (the trip detail
// page itself) is unchanged.

import { useState, FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

export default function MyTripLookupPage() {
  const t = useTranslations('myTripLookup');
  const router = useRouter();

  const [orderNumber, setOrderNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedOrderNumber = orderNumber.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedOrderNumber || !trimmedPhone) {
      setError(t('error'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/my-trip/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_number: trimmedOrderNumber, phone: trimmedPhone }),
      });
      const result = await res.json();

      if (!res.ok) {
        setError(result?.error || t('notFound'));
        return;
      }

      router.push(`/my-trip/${result.order_number}?token=${encodeURIComponent(result.token)}`);
    } catch {
      setError(t('notFound'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold text-center mb-2">{t('title')}</h1>
      <p className="text-center text-gray-500 mb-8">{t('description')}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="form-label" htmlFor="my-trip-order-number">
            {t('orderNumberLabel')}
          </label>
          <input
            id="my-trip-order-number"
            type="text"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder={t('placeholder')}
            className="form-input w-full"
            autoComplete="off"
          />
        </div>

        <div>
          <label className="form-label" htmlFor="my-trip-phone">
            {t('phoneLabel')}
          </label>
          <input
            id="my-trip-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('phonePlaceholder')}
            className="form-input w-full"
            autoComplete="tel"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? t('submitting') : t('submit')}
        </button>
      </form>
    </main>
  );
}
