'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Reads B2B partner-application leads submitted via the public
// /become-partner form. BecomePartnerForm.tsx inserts these into the
// `cases` table (NOT `bookings`, NOT `partners`/`organizations`) with:
//   - service_type: "[B2B] {clinic_hospital|hotel_resort|transport_agent|investor}"
//   - status: "new_lead_b2b"
// This tab is the only place in admin that surfaces those rows — before
// this component existed, submitted leads sat in `cases` with nothing
// in the UI reading them.
//
// Follow-up flow this component introduces (not present before):
//   new_lead_b2b -> contacted_b2b -> converted_b2b | rejected_b2b
// These extra status values are new; nothing else in the codebase reads
// or depends on them, so they're safe to introduce here.

type LeadStatus = 'new_lead_b2b' | 'contacted_b2b' | 'converted_b2b' | 'rejected_b2b';

interface Lead {
  id: string;
  patient_name: string | null;
  phone_number: string | null;
  service_type: string | null;
  hospital: string | null;
  message: string | null;
  status: string;
  created_at: string;
}

// clinic_hospital/hotel_resort/transport_agent/investor = เดิม (จาก
// BecomePartnerForm.tsx, เก็บไว้ให้ row เก่ายังขึ้น label ถูก) ส่วน
// hospital/clinic/hotel/transport/corporate = จากฟอร์มใหม่ /partner/apply
// (ApplyForm.tsx) — ต้อง sync กับ BUSINESS_TYPE_TO_LABEL_KEY ที่นั่นด้วย
const BUSINESS_TYPE_LABEL: Record<string, string> = {
  clinic_hospital: 'คลินิก / โรงพยาบาล',
  hotel_resort: 'โรงแรม / ที่พัก',
  transport_agent: 'ผู้ให้บริการเดินทาง / รถรับส่ง',
  investor: 'นักลงทุน / ผู้สนใจร่วมธุรกิจ',
  hospital: 'โรงพยาบาล',
  clinic: 'คลินิก',
  hotel: 'โรงแรม / ที่พัก',
  transport: 'ผู้ให้บริการเดินทาง / รถรับส่ง',
  corporate: 'องค์กร / บริษัท',
  wellness_spa: 'กลุ่มบริการ Wellness และ สปา',
};

const STATUS_LABEL: Record<LeadStatus, string> = {
  new_lead_b2b: '⏳ รอติดต่อ',
  contacted_b2b: '💬 ติดต่อแล้ว',
  converted_b2b: '✅ เป็นพันธมิตรแล้ว',
  rejected_b2b: '❌ ไม่สนใจ/ปฏิเสธ',
};

const STATUS_BADGE_CLASS: Record<LeadStatus, string> = {
  new_lead_b2b: 'bg-amber-100 text-amber-800',
  contacted_b2b: 'bg-blue-100 text-blue-800',
  converted_b2b: 'bg-emerald-100 text-emerald-800',
  rejected_b2b: 'bg-red-100 text-red-800',
};

// BecomePartnerForm.tsx saves patient_name as "ContactName (CompanyName)"
function parseContact(patientName: string | null) {
  if (!patientName) return { contactName: '-', companyName: '-' };
  const match = patientName.match(/^(.*)\s\((.*)\)$/);
  if (!match) return { contactName: patientName, companyName: '-' };
  return { contactName: match[1], companyName: match[2] };
}

function businessTypeLabel(serviceType: string | null) {
  if (!serviceType) return '-';
  const key = serviceType.replace('[B2B]', '').trim();
  return BUSINESS_TYPE_LABEL[key] || key || '-';
}

// Same normalization approach as BookingsManager.tsx's toWhatsAppNumber,
// simplified since leads don't have a `country` field to disambiguate.
function toWhatsAppNumber(phone: string | null) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = '66' + digits.slice(1);
  return digits;
}

export function PartnerLeadsManager() {
  const supabase = createClient();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | LeadStatus>('all');
  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadLeads() {
    setLoading(true);
    setListError(null);
    // service_type prefix is the source of truth for "this is a B2B lead" —
    // status changes over time as admin follows up, so we can't filter on
    // status alone.
    const { data, error } = await supabase
      .from('cases')
      .select('id, patient_name, phone_number, service_type, hospital, message, status, created_at')
      .ilike('service_type', '[B2B]%')
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) {
      setListError('โหลดข้อมูลไม่สำเร็จ: ' + error.message);
      return;
    }
    setLeads((data ?? []) as Lead[]);
  }

  useEffect(() => {
    loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (statusFilter === 'all' ? leads : leads.filter((l) => l.status === statusFilter)),
    [leads, statusFilter]
  );

  const newCount = leads.filter((l) => l.status === 'new_lead_b2b').length;

  async function updateStatus(id: string, newStatus: LeadStatus) {
    setSavingId(id);
    const { error } = await supabase.from('cases').update({ status: newStatus }).eq('id', id);
    setSavingId(null);
    if (error) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + error.message);
      return;
    }
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status: newStatus } : l)));
  }

  const statusPills: { value: 'all' | LeadStatus; label: string }[] = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'new_lead_b2b', label: STATUS_LABEL.new_lead_b2b },
    { value: 'contacted_b2b', label: STATUS_LABEL.contacted_b2b },
    { value: 'converted_b2b', label: STATUS_LABEL.converted_b2b },
    { value: 'rejected_b2b', label: STATUS_LABEL.rejected_b2b },
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
            🤝 พันธมิตรสมัครใหม่ (B2B) ({leads.length})
            {newCount > 0 ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {newCount} รอติดต่อ
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            รายชื่อจากฟอร์ม &quot;สมัครเป็นพันธมิตรธุรกิจ&quot; หน้า /become-partner · ทั้งหมด {leads.length} รายการ · แสดง {filtered.length} รายการ
          </p>
        </div>
        <button onClick={loadLeads} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
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
          📭 ยังไม่มีพันธมิตรสมัครเข้ามาในหมวดนี้
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-slate-100 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">สมัครเมื่อ</th>
                <th className="px-4 py-3 font-semibold">ผู้ติดต่อ / บริษัท</th>
                <th className="px-4 py-3 font-semibold">ติดต่อ</th>
                <th className="px-4 py-3 font-semibold">ประเภทธุรกิจ</th>
                <th className="px-4 py-3 font-semibold">ข้อมูลเพิ่มเติม</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => {
                const { contactName, companyName } = parseContact(lead.patient_name);
                const displayCompany = companyName !== '-' ? companyName : lead.hospital || '-';
                const createdAt = lead.created_at ? new Date(lead.created_at).toLocaleString('th-TH') : '-';
                const waNumber = toWhatsAppNumber(lead.phone_number);
                const busy = savingId === lead.id;
                const status = (lead.status as LeadStatus) in STATUS_LABEL ? (lead.status as LeadStatus) : 'new_lead_b2b';

                return (
                  <tr key={lead.id} className="border-b border-slate-50 align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{createdAt}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{displayCompany}</div>
                      <div className="text-xs text-slate-500">{contactName}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{lead.phone_number || '-'}</div>
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
                    <td className="px-4 py-3 text-slate-700">{businessTypeLabel(lead.service_type)}</td>
                    <td className="max-w-[220px] px-4 py-3 text-xs text-slate-500">{lead.message || '-'}</td>
                    <td className="px-4 py-3">
                      <select
                        disabled={busy}
                        value={status}
                        onChange={(e) => updateStatus(lead.id, e.target.value as LeadStatus)}
                        className={`rounded-lg border-0 px-2 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[status]}`}
                      >
                        <option value="new_lead_b2b">{STATUS_LABEL.new_lead_b2b}</option>
                        <option value="contacted_b2b">{STATUS_LABEL.contacted_b2b}</option>
                        <option value="converted_b2b">{STATUS_LABEL.converted_b2b}</option>
                        <option value="rejected_b2b">{STATUS_LABEL.rejected_b2b}</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
