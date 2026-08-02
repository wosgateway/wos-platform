// src/components/BecomePartnerForm.tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';

const BUSINESS_TYPES = ['clinic_hospital', 'hotel_resort', 'transport_agent', 'investor'] as const;
type BusinessType = (typeof BUSINESS_TYPES)[number];

interface FormState {
  contactName: string;
  companyName: string;
  phone: string;
  partnerType: BusinessType;
  message: string;
}

const emptyForm: FormState = {
  contactName: '',
  companyName: '',
  phone: '',
  partnerType: 'clinic_hospital',
  message: '',
};

export function BecomePartnerForm() {
  const t = useTranslations('becomePartner.form');
  const supabase = createClient();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

  function validate(): boolean {
    const nextErrors: Record<string, boolean> = {
      contactName: !form.contactName.trim(),
      companyName: !form.companyName.trim(),
      phone: !form.phone.trim(),
    };
    setErrors(nextErrors);
    return !Object.values(nextErrors).some(Boolean);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    if (!validate()) {
      setStatus({ type: 'warning', message: t('validationError') });
      return;
    }

    setSubmitting(true);

    // เหมือนกับ payload เดิมใน partner.html inline script:
    // insert เข้า table 'cases' โดย prefix service_type ด้วย "[B2B]"
    // เพื่อให้แยกจาก case จองบริการปกติของผู้ป่วยได้ใน admin
    const payload = {
      patient_name: `${form.contactName.trim()} (${form.companyName.trim()})`,
      phone_number: form.phone.trim(),
      service_type: `[B2B] ${form.partnerType}`,
      hospital: form.companyName.trim(),
      travel_date: null,
      message: form.message.trim() || null,
      status: 'new_lead_b2b',
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('cases').insert([payload]);
    setSubmitting(false);

    if (error) {
      setStatus({ type: 'error', message: t('errorPrefix') + error.message });
      return;
    }

    setStatus({ type: 'success', message: t('success') });
    setForm(emptyForm);
    setErrors({});
  }

  const statusClass =
    status?.type === 'success'
      ? 'text-emerald-700 bg-emerald-50'
      : status?.type === 'error'
        ? 'text-red-700 bg-red-50'
        : 'text-amber-700 bg-amber-50';

  return (
    <section className="bg-white py-12">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-6 text-xl font-bold text-slate-900">{t('heading')}</h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div>
              <label className="form-label">
                {t('contactName')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                className={`form-input ${errors.contactName ? 'error' : ''}`}
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              />
            </div>

            <div>
              <label className="form-label">
                {t('companyName')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                className={`form-input ${errors.companyName ? 'error' : ''}`}
                placeholder={t('companyNamePlaceholder')}
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              />
            </div>

            <div>
              <label className="form-label">
                {t('phone')} <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                required
                className={`form-input ${errors.phone ? 'error' : ''}`}
                placeholder={t('phonePlaceholder')}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div>
              <label className="form-label">
                {t('businessType')} <span className="text-red-500">*</span>
              </label>
              <select
                className="form-input bg-white"
                value={form.partnerType}
                onChange={(e) => setForm({ ...form, partnerType: e.target.value as BusinessType })}
              >
                <option value="clinic_hospital">{t('typeClinic')}</option>
                <option value="hotel_resort">{t('typeHotel')}</option>
                <option value="transport_agent">{t('typeTransport')}</option>
                <option value="investor">{t('typeInvestor')}</option>
              </select>
            </div>

            <div>
              <label className="form-label">{t('additionalInfo')}</label>
              <textarea
                rows={3}
                className="form-input"
                placeholder={t('additionalInfoPlaceholder')}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </div>

            <button type="submit" disabled={submitting} className="btn-primary w-full justify-center text-base disabled:opacity-60">
              {submitting ? t('submitting') : t('submit')}
            </button>

            {status ? (
              <div className={`mt-4 rounded-xl p-3 text-center text-sm font-medium ${statusClass}`}>
                {status.message}
              </div>
            ) : null}
          </form>
        </div>
      </div>
    </section>
  );
}
