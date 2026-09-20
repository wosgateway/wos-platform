'use client';

// src/components/admin/PartnerApplicationsManager.tsx
//
// Reads B2B partner-application leads submitted via the public
// /become-partner form (BecomePartnerForm.tsx), which insert into
// public.partner_applications — see sql/030_partner_applications.sql.
//
// Before this component existed, submitted rows here had NO admin UI
// at all (PartnerLeadsManager.tsx only ever read public.cases, which
// BecomePartnerForm.tsx stopped writing to once partner_applications
// was created). Every /become-partner submission since that switch
// was sitting in the DB, untouched, invisible — not lost, just never
// surfaced. This tab is that missing surface.
//
// Status values here come from the table's own CHECK constraint
// (PENDING | UNDER_REVIEW | NEEDS_INFO | APPROVED | REJECTED) — unlike
// PartnerLeadsManager's cases-based *_b2b statuses, these are DB-enforced.
// "แปลงเป็นพันธมิตร" (Convert) sets status to APPROVED itself as part of
// the provision route's atomic claim step — this UI never sets APPROVED
// directly.

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ConvertToPartnerModal, type ConvertPrefill } from './ConvertToPartnerModal';

type AppStatus = 'PENDING' | 'UNDER_REVIEW' | 'NEEDS_INFO' | 'REJECTED';
// APPROVED is reachable only via the Convert modal (provision route sets
// it atomically), so it's excluded from the manual dropdown below but
// still handled everywhere else a row's real status is read/displayed.
type FullStatus = AppStatus | 'APPROVED';

interface Application {
  id: string;
  company_name: string;
  business_type: string;
  primary_name: string;
  primary_email: string | null;
  primary_phone: string;
  province: string | null;
  message: string | null;
  status: string;
  submitted_at: string;
}

// Keep in sync with BecomePartnerForm.tsx's BUSINESS_TYPES.
const BUSINESS_TYPE_LABEL: Record<string, string> = {
  clinic_hospital: 'คลินิก / โรงพยาบาล',
  hotel_resort: 'โรงแรม / ที่พัก',
  transport_agent: 'ผู้ให้บริการเดินทาง / รถรับส่ง',
  investor: 'นักลงทุน / ผู้สนใจร่วมธุรกิจ',
};

// Best-guess mapping into provision's PARTNER_CATEGORIES enum — admin
// can still change it in the Convert modal before submitting.
const BUSINESS_TYPE_TO_CATEGORY: Record<string, ConvertPrefill['category']> = {
  clinic_hospital: 'Hospital',
  hotel_resort: 'Hotel',
  transport_agent: 'Transport',
  investor: '',
};

const STATUS_LABEL: Record<FullStatus, string> = {
  PENDING: '⏳ รอตรวจสอบ',
  UNDER_REVIEW: '🔍 กำลังตรวจสอบ',
  NEEDS_INFO: '❓ ขอข้อมูลเพิ่ม',
  APPROVED: '✅ เป็นพันธมิตรแล้ว',
  REJECTED: '❌ ไม่อนุมัติ',
};

const STATUS_BADGE_CLASS: Record<FullStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  UNDER_REVIEW: 'bg-blue-100 text-blue-800',
  NEEDS_INFO: 'bg-orange-100 text-orange-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
};

const MANUAL_STATUS_OPTIONS: AppStatus[] = ['PENDING', 'UNDER_REVIEW', 'NEEDS_INFO', 'REJECTED'];

function toWhatsAppNumber(phone: string | null) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = '66' + digits.slice(1);
  return digits;
}

export function PartnerApplicationsManager() {
  // Must match AdminGate's 'sb-wos-admin' cookie namespace — same
  // reasoning as PartnerLeadsManager.tsx / PartnersManager.tsx.
  const supabase = createClient('admin');
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | FullStatus>('all');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [convertTarget, setConvertTarget] = useState<Application | null>(null);

  async function loadApplications() {
    setLoading(true);
    setListError(null);
    const { data, error } = await supabase
      .from('partner_applications')
      .select('id, company_name, business_type, primary_name, primary_email, primary_phone, province, message, status, submitted_at')
      .order('submitted_at', { ascending: false });
    setLoading(false);
    if (error) {
      setListError('โหลดข้อมูลไม่สำเร็จ: ' + error.message);
      return;
    }
    setApplications((data ?? []) as Application[]);
  }

  useEffect(() => {
    loadApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (statusFilter === 'all' ? applications : applications.filter((a) => a.status === statusFilter)),
    [applications, statusFilter]
  );

  const pendingCount = applications.filter((a) => a.status === 'PENDING').length;

  async function updateStatus(id: string, newStatus: AppStatus) {
    setSavingId(id);
    const { error } = await supabase.from('partner_applications').update({ status: newStatus }).eq('id', id);
    setSavingId(null);
    if (error) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + error.message);
      return;
    }
    setApplications((prev) => prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a)));
  }

  const statusPills: { value: 'all' | FullStatus; label: string }[] = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'PENDING', label: STATUS_LABEL.PENDING },
    { value: 'UNDER_REVIEW', label: STATUS_LABEL.UNDER_REVIEW },
    { value: 'NEEDS_INFO', label: STATUS_LABEL.NEEDS_INFO },
    { value: 'APPROVED', label: STATUS_LABEL.APPROVED },
    { value: 'REJECTED', label: STATUS_LABEL.REJECTED },
  ];

  const pillClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
    }`;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            📝 พันธมิตรสมัครใหม่ ({applications.length})
            {pendingCount > 0 ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {pendingCount} รอตรวจสอบ
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            รายชื่อจากฟอร์ม &quot;สมัครเป็นพันธมิตรธุรกิจ&quot; หน้า /become-partner · ทั้งหมด {applications.length} รายการ · แสดง {filtered.length} รายการ
          </p>
        </div>
        <button onClick={loadApplications} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
          🔄 รีเฟรช
        </button>
      </div>

      {listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{listError}</div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {statusPills.map((p) => (
          <button key={p.value} onClick={() => setStatusFilter(p.value)} className={pillClass(statusFilter === p.value)}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
          📭 ยังไม่มีใบสมัครในหมวดนี้
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-100 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">สมัครเมื่อ</th>
                <th className="px-4 py-3 font-semibold">ผู้ติดต่อ / บริษัท</th>
                <th className="px-4 py-3 font-semibold">ติดต่อ</th>
                <th className="px-4 py-3 font-semibold">ประเภทธุรกิจ</th>
                <th className="px-4 py-3 font-semibold">ข้อมูลเพิ่มเติม</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((app) => {
                const createdAt = app.submitted_at ? new Date(app.submitted_at).toLocaleString('th-TH') : '-';
                const waNumber = toWhatsAppNumber(app.primary_phone);
                const busy = savingId === app.id;
                const status = (app.status as FullStatus) in STATUS_LABEL ? (app.status as FullStatus) : 'PENDING';
                const isApproved = status === 'APPROVED';

                return (
                  <tr key={app.id} className="border-b border-slate-50 align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{createdAt}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{app.company_name}</div>
                      <div className="text-xs text-slate-500">{app.primary_name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{app.primary_phone || '-'}</div>
                      {app.primary_email ? <div className="text-xs text-slate-400">{app.primary_email}</div> : null}
                      {waNumber ? (
                        <a
                          href={`https://wa.me/${waNumber}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary-dark hover:underline"
                        >
                          📱 WhatsApp
                        </a>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {BUSINESS_TYPE_LABEL[app.business_type] || app.business_type}
                      {app.province ? <div className="text-xs text-slate-400">{app.province}</div> : null}
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-xs text-slate-500">{app.message || '-'}</td>
                    <td className="px-4 py-3">
                      {isApproved ? (
                        <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS.APPROVED}`}>
                          {STATUS_LABEL.APPROVED}
                        </span>
                      ) : (
                        <select
                          disabled={busy}
                          value={status}
                          onChange={(e) => updateStatus(app.id, e.target.value as AppStatus)}
                          className={`rounded-lg border-0 px-2 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[status]}`}
                        >
                          {MANUAL_STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!isApproved ? (
                        <button
                          onClick={() => setConvertTarget(app)}
                          className="whitespace-nowrap rounded-lg border border-primary px-3 py-1.5 text-xs font-semibold text-primary-dark hover:bg-primary/5"
                        >
                          แปลงเป็นพันธมิตร →
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {convertTarget ? (
        <ConvertToPartnerModal
          leadSource="partner_application"
          leadId={convertTarget.id}
          prefill={{
            organizationName: convertTarget.company_name,
            category: BUSINESS_TYPE_TO_CATEGORY[convertTarget.business_type] ?? '',
            province: convertTarget.province || '',
            contactName: convertTarget.primary_name,
            contactEmail: convertTarget.primary_email || '',
            contactPhone: convertTarget.primary_phone || '',
          }}
          onClose={() => setConvertTarget(null)}
          onConverted={() => {
            loadApplications();
          }}
        />
      ) : null}
    </div>
  );
}
