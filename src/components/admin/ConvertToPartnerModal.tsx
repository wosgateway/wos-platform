'use client';

// src/components/admin/ConvertToPartnerModal.tsx
//
// Shared "แปลงเป็นพันธมิตร" modal for both B2B lead sources:
//   - PartnerLeadsManager.tsx        (public.cases,               leadSource: 'case')
//   - PartnerApplicationsManager.tsx (public.partner_applications, leadSource: 'partner_application')
//
// This is the UI that was missing: /api/admin/partners/provision has
// existed since it was built, fully working (org -> branch -> partner
// listing -> Auth invite -> public.users, with claim/rollback logic),
// but nothing ever called it. This modal is that caller.
//
// Admin reviews/edits every field before submit — provision route
// deliberately never guesses values from the lead's free-text fields,
// so this form pre-fills from the lead but submits whatever the admin
// confirms, not the raw lead row.

import { useState } from 'react';

const PARTNER_CATEGORIES = ['Hospital', 'Clinic', 'Dental', 'Wellness', 'Spa', 'Hotel', 'Transport'] as const;
type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

const CATEGORY_LABEL: Record<PartnerCategory, string> = {
  Hospital: 'โรงพยาบาล',
  Clinic: 'คลินิก & ความงาม',
  Dental: 'ทันตกรรม',
  Wellness: 'เวลเนส & แพทย์ทางเลือก',
  Spa: 'สปา & ผ่อนคลาย',
  Hotel: 'โรงแรม',
  Transport: 'รถรับส่ง / เดินทาง',
};

export type LeadSource = 'case' | 'partner_application';

export interface ConvertPrefill {
  organizationName: string;
  branchName?: string;
  category?: PartnerCategory | '';
  province?: string;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
}

interface ConvertToPartnerModalProps {
  leadSource: LeadSource;
  leadId: string;
  prefill: ConvertPrefill;
  onClose: () => void;
  onConverted: () => void;
}

interface FormState {
  organizationName: string;
  branchName: string;
  category: PartnerCategory | '';
  province: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  existingPartnerId: string;
}

export function ConvertToPartnerModal({ leadSource, leadId, prefill, onClose, onConverted }: ConvertToPartnerModalProps) {
  const [form, setForm] = useState<FormState>({
    organizationName: prefill.organizationName || '',
    branchName: prefill.branchName || prefill.organizationName || '',
    category: prefill.category || '',
    province: prefill.province || '',
    contactName: prefill.contactName || '',
    contactEmail: prefill.contactEmail || '',
    contactPhone: prefill.contactPhone || '',
    existingPartnerId: '',
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    inviteLink: string | null;
    organizationId: string;
    branchId: string;
    partnerId: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.organizationName.trim()) return setError('กรุณากรอกชื่อองค์กร');
    if (!form.branchName.trim()) return setError('กรุณากรอกชื่อสาขา');
    if (!form.category) return setError('กรุณาเลือกประเภทธุรกิจ');
    if (!form.contactName.trim()) return setError('กรุณากรอกชื่อผู้ติดต่อ');
    if (!form.contactEmail.trim() || !form.contactEmail.includes('@')) {
      return setError('กรุณากรอกอีเมลผู้ติดต่อที่ถูกต้อง (ใช้ส่งลิงก์ตั้งรหัสผ่าน)');
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/partners/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadSource,
          leadId,
          organizationName: form.organizationName.trim(),
          branchName: form.branchName.trim(),
          category: form.category,
          province: form.province.trim() || null,
          contactName: form.contactName.trim(),
          contactEmail: form.contactEmail.trim(),
          contactPhone: form.contactPhone.trim() || null,
          existingPartnerId: form.existingPartnerId.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'แปลงเป็นพันธมิตรไม่สำเร็จ');
        return;
      }
      setResult({
        inviteLink: data.inviteLink ?? null,
        organizationId: data.organizationId,
        branchId: data.branchId,
        partnerId: data.partnerId,
      });
      onConverted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'แปลงเป็นพันธมิตรไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!result?.inviteLink) return;
    await navigator.clipboard.writeText(result.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        {result ? (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-emerald-700">✅ แปลงเป็นพันธมิตรสำเร็จ</h3>
            <p className="text-sm text-slate-600">
              สร้าง Organization / Branch / Partner listing และส่งคำเชิญตั้งรหัสผ่านไปที่ {form.contactEmail} แล้ว
            </p>
            {result.inviteLink ? (
              <div className="space-y-1">
                <div className="text-xs font-medium text-slate-500">ลิงก์ตั้งรหัสผ่าน (สำรอง ส่งเองผ่าน LINE/WhatsApp ได้)</div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={result.inviteLink}
                    className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    onClick={copyLink}
                    className="whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                  >
                    {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก'}
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="btn-primary w-full justify-center text-sm"
            >
              เสร็จสิ้น
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">แปลงเป็นพันธมิตร</h3>
              <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-500">
              ตรวจสอบ/แก้ไขข้อมูลก่อนสร้างบัญชีจริง — ระบบจะสร้าง Organization, Branch, รายชื่อพันธมิตรในไดเรกทอรี และส่งอีเมลเชิญตั้งรหัสผ่านให้ผู้ติดต่อ
            </p>

            <div>
              <label className="form-label">ชื่อองค์กร *</label>
              <input
                className="form-input"
                value={form.organizationName}
                onChange={(e) => set('organizationName', e.target.value)}
              />
            </div>

            <div>
              <label className="form-label">ชื่อสาขา *</label>
              <input className="form-input" value={form.branchName} onChange={(e) => set('branchName', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">ประเภทธุรกิจ *</label>
                <select
                  className="form-input bg-white"
                  value={form.category}
                  onChange={(e) => set('category', e.target.value as PartnerCategory)}
                >
                  <option value="">เลือก...</option>
                  {PARTNER_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">จังหวัด</label>
                <input className="form-input" value={form.province} onChange={(e) => set('province', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="form-label">ชื่อผู้ติดต่อ *</label>
              <input className="form-input" value={form.contactName} onChange={(e) => set('contactName', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">อีเมลผู้ติดต่อ *</label>
                <input
                  type="email"
                  className="form-input"
                  value={form.contactEmail}
                  onChange={(e) => set('contactEmail', e.target.value)}
                  placeholder="ใช้ส่งลิงก์ตั้งรหัสผ่าน"
                />
              </div>
              <div>
                <label className="form-label">เบอร์โทร</label>
                <input className="form-input" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-medium text-primary-dark hover:underline"
            >
              {showAdvanced ? '▲ ซ่อนตัวเลือกเพิ่มเติม' : '▼ ตัวเลือกเพิ่มเติม (เชื่อมกับ Partner listing เดิม)'}
            </button>
            {showAdvanced ? (
              <div>
                <label className="form-label">Existing Partner ID (ถ้าธุรกิจนี้มีรายชื่ออยู่แล้วในไดเรกทอรี)</label>
                <input
                  className="form-input"
                  value={form.existingPartnerId}
                  onChange={(e) => set('existingPartnerId', e.target.value)}
                  placeholder="เว้นว่างถ้าจะสร้างรายชื่อใหม่"
                />
              </div>
            ) : null}

            {error ? <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center text-sm disabled:opacity-60">
                {submitting ? 'กำลังสร้าง...' : 'ยืนยันแปลงเป็นพันธมิตร'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
