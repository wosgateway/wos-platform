'use client';

// src/components/admin/ConsultationsManager.tsx
//
// Phase 4 of "ปรึกษา WOS ฟรี" — admin view of leads submitted through the
// public /[locale]/consultation form (Phase 1) via /api/consultation
// (Phase 2). Before this component existed, submitted rows sat in
// `consultation_requests` with nothing in the admin UI reading them —
// same gap PartnerLeadsManager.tsx closed for /become-partner leads.
//
// Reads/writes go straight to Supabase from the client, same pattern as
// PartnerLeadsManager.tsx / PartnersManager.tsx — createClient('admin')
// carries the 'sb-wos-admin' cookie AdminGate signs in, which is what
// consultation_requests' RLS policy checks via is_platform_admin() (see
// 091_consultation_requests.sql). No new API route needed for this tab.
//
// Status transitions are NOT a free-form <select> like PartnerLeadsManager
// uses for `cases.status` — 091_consultation_requests.sql's
// enforce_consultation_status_transition trigger only allows
//   new -> contacted | closed
//   contacted -> qualified | closed
//   qualified -> converted | closed
//   converted -> closed
//   closed -> (terminal)
// so the UI only ever offers the specific next steps valid from the
// current status, instead of a dropdown that can attempt an invalid jump
// and surface a raw Postgres trigger exception to the admin.

import { useEffect, useMemo, useState, Fragment } from 'react';
import { createClient } from '@/lib/supabase/client';

type ConsultationStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'closed';

interface ConsultationRequest {
  id: string;
  language: string;
  name: string;
  contact_channel: string;
  contact_value: string;
  country: string;
  request_types: string[];
  message: string | null;
  travel_period: string;
  status: ConsultationStatus;
  source: string;
  utm_campaign: string | null;
  internal_notes: string | null;
  contacted_by: string | null;
  contacted_at: string | null;
  created_at: string;
}

// Keep in sync with the CHECK constraints in 091_consultation_requests.sql
// and the enums in src/app/api/consultation/route.ts.
const STATUS_LABEL: Record<ConsultationStatus, string> = {
  new: '⏳ ใหม่',
  contacted: '💬 ติดต่อแล้ว',
  qualified: '👍 คุยแล้ว มีลุ้น',
  converted: '✅ เป็นทริปแล้ว',
  closed: '🔒 ปิดเคส',
};

const STATUS_BADGE_CLASS: Record<ConsultationStatus, string> = {
  new: 'bg-amber-100 text-amber-800',
  contacted: 'bg-blue-100 text-blue-800',
  qualified: 'bg-violet-100 text-violet-800',
  converted: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-200 text-slate-600',
};

// Mirrors enforce_consultation_status_transition() exactly — the DB is
// still the real enforcement (defense in depth), this just keeps the UI
// from ever offering a button that would fail.
const NEXT_STATUSES: Record<ConsultationStatus, ConsultationStatus[]> = {
  new: ['contacted', 'closed'],
  contacted: ['qualified', 'closed'],
  qualified: ['converted', 'closed'],
  converted: ['closed'],
  closed: [],
};

const CONTACT_CHANNEL_LABEL: Record<string, string> = {
  phone: 'โทรศัพท์',
  whatsapp: 'WhatsApp',
  line: 'LINE',
  email: 'อีเมล',
  other: 'อื่นๆ',
};

const REQUEST_TYPE_LABEL: Record<string, string> = {
  health_checkup: 'ตรวจสุขภาพ',
  medical_treatment: 'รักษาพยาบาล',
  dental: 'ทันตกรรม',
  wellness: 'เวลเนส',
  aesthetic: 'ความงาม',
  hospital_clinic: 'โรงพยาบาล/คลินิก',
  hotel: 'โรงแรมที่พัก',
  transport: 'รถรับส่ง',
  not_sure: 'ยังไม่แน่ใจ',
};

const TRAVEL_PERIOD_LABEL: Record<string, string> = {
  unspecified: 'ยังไม่กำหนด',
  within_1_month: 'ภายใน 1 เดือน',
  '1_to_3_months': '1-3 เดือน',
  more_than_3_months: 'มากกว่า 3 เดือน',
};

const SOURCE_LABEL: Record<string, string> = {
  homepage_hero: 'Homepage (บนสุด)',
  homepage_bottom: 'Homepage (ล่างสุด)',
  partner_page: 'หน้าพันธมิตร',
  package_page: 'หน้าแพ็กเกจ',
  knowledge_center: 'Knowledge Center',
  unknown: 'ไม่ทราบที่มา',
};

const LANGUAGE_LABEL: Record<string, string> = { th: '🇹🇭 ไทย', en: '🇬🇧 English', lo: '🇱🇦 ລາວ' };

// Same normalization as BookingsManager.tsx's toWhatsAppNumber /
// PartnerLeadsManager.tsx's toWhatsAppNumber — a bare 0-prefixed Thai
// number gets a guessed 66 country code; anything else (already has a
// country code, is Lao, etc.) is left as digits-only rather than risk a
// wrong guess.
function toWhatsAppNumber(value: string) {
  let digits = value.replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = '66' + digits.slice(1);
  return digits;
}

function contactLink(channel: string, value: string): { href: string; label: string } | null {
  switch (channel) {
    case 'phone':
      return { href: `tel:${value.replace(/[^0-9+]/g, '')}`, label: '📞 โทร' };
    case 'whatsapp': {
      const wa = toWhatsAppNumber(value);
      return wa ? { href: `https://wa.me/${wa}`, label: '📱 WhatsApp' } : null;
    }
    case 'line':
      // Best-effort — LINE has no universal "open chat with this ID" web
      // link, so this only reliably works when the customer entered a
      // valid LINE ID (not a display name). Still faster than manually
      // opening the LINE app and searching for it.
      return { href: `https://line.me/ti/p/~${encodeURIComponent(value)}`, label: '💬 LINE' };
    case 'email':
      return { href: `mailto:${value}`, label: '✉️ อีเมล' };
    default:
      return null;
  }
}

export function ConsultationsManager() {
  // Must match AdminGate's 'sb-wos-admin' cookie — see PartnersManager.tsx's
  // identical comment — or reads/writes here fail RLS as unauthenticated.
  const supabase = createClient('admin');
  const [rows, setRows] = useState<ConsultationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | ConsultationStatus>('all');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [adminEmail, setAdminEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAdminEmail(data.session?.user?.email ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRows() {
    setLoading(true);
    setListError(null);
    const { data, error } = await supabase
      .from('consultation_requests')
      .select(
        'id, language, name, contact_channel, contact_value, country, request_types, message, travel_period, status, source, utm_campaign, internal_notes, contacted_by, contacted_at, created_at'
      )
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) {
      setListError('โหลดข้อมูลไม่สำเร็จ: ' + error.message);
      return;
    }
    setRows((data ?? []) as ConsultationRequest[]);
  }

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter]
  );

  const newCount = rows.filter((r) => r.status === 'new').length;

  async function updateStatus(id: string, nextStatus: ConsultationStatus) {
    setSavingId(id);
    // "contacted" is the funnel's definition of "someone at WOS actually
    // reached out" (see the status COMMENT ON COLUMN in the SQL file), so
    // stamp who/when in the same update rather than requiring a second
    // save on the notes field for that to be recorded.
    const patch: Partial<ConsultationRequest> =
      nextStatus === 'contacted'
        ? { status: nextStatus, contacted_by: adminEmail, contacted_at: new Date().toISOString() }
        : { status: nextStatus };

    const { error } = await supabase.from('consultation_requests').update(patch).eq('id', id);
    setSavingId(null);
    if (error) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? ({ ...r, ...patch } as ConsultationRequest) : r)));
  }

  async function saveNote(id: string) {
    setSavingId(id);
    const { error } = await supabase
      .from('consultation_requests')
      .update({ internal_notes: noteDraft || null })
      .eq('id', id);
    setSavingId(null);
    if (error) {
      alert('บันทึกโน้ตไม่สำเร็จ: ' + error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, internal_notes: noteDraft || null } : r)));
  }

  function toggleExpand(row: ConsultationRequest) {
    if (expandedId === row.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(row.id);
    setNoteDraft(row.internal_notes ?? '');
  }

  const statusPills: { value: 'all' | ConsultationStatus; label: string }[] = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'new', label: STATUS_LABEL.new },
    { value: 'contacted', label: STATUS_LABEL.contacted },
    { value: 'qualified', label: STATUS_LABEL.qualified },
    { value: 'converted', label: STATUS_LABEL.converted },
    { value: 'closed', label: STATUS_LABEL.closed },
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
            🩺 ปรึกษา WOS ฟรี ({rows.length})
            {newCount > 0 ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {newCount} ใหม่
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            รายชื่อจากฟอร์ม &quot;ปรึกษา WOS ฟรี&quot; หน้า /consultation · ทั้งหมด {rows.length} รายการ · แสดง{' '}
            {filtered.length} รายการ
          </p>
        </div>
        <button onClick={loadRows} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
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
          📭 ยังไม่มีคำขอปรึกษาในหมวดนี้
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-slate-100 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">ส่งเมื่อ</th>
                <th className="px-4 py-3 font-semibold">ชื่อ / ประเทศ</th>
                <th className="px-4 py-3 font-semibold">ติดต่อ</th>
                <th className="px-4 py-3 font-semibold">สนใจ</th>
                <th className="px-4 py-3 font-semibold">ช่วงเวลา</th>
                <th className="px-4 py-3 font-semibold">ที่มา</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const busy = savingId === row.id;
                const link = contactLink(row.contact_channel, row.contact_value);
                const createdAt = row.created_at ? new Date(row.created_at).toLocaleString('th-TH') : '-';
                const expanded = expandedId === row.id;

                return (
                  <Fragment key={row.id}>
                    <tr className="border-b border-slate-50 align-top hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {createdAt}
                        <div className="mt-1">{LANGUAGE_LABEL[row.language] ?? row.language}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{row.name}</div>
                        <div className="text-xs text-slate-500">{row.country}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>
                          {CONTACT_CHANNEL_LABEL[row.contact_channel] ?? row.contact_channel}: {row.contact_value}
                        </div>
                        {link ? (
                          <a
                            href={link.href}
                            target={link.href.startsWith('http') ? '_blank' : undefined}
                            rel="noopener noreferrer"
                            className="text-xs text-primary-dark hover:underline"
                          >
                            {link.label}
                          </a>
                        ) : null}
                      </td>
                      <td className="max-w-[200px] px-4 py-3 text-xs text-slate-600">
                        {row.request_types.map((t) => REQUEST_TYPE_LABEL[t] ?? t).join(', ')}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {TRAVEL_PERIOD_LABEL[row.travel_period] ?? row.travel_period}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {SOURCE_LABEL[row.source] ?? row.source}
                        {row.utm_campaign ? <div className="text-slate-400">#{row.utm_campaign}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-lg px-2 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[row.status]}`}
                        >
                          {STATUS_LABEL[row.status] ?? row.status}
                        </span>
                        {NEXT_STATUSES[row.status].length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {NEXT_STATUSES[row.status].map((next) => (
                              <button
                                key={next}
                                disabled={busy}
                                onClick={() => updateStatus(row.id, next)}
                                className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                              >
                                → {STATUS_LABEL[next]}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleExpand(row)}
                          className="text-xs font-medium text-primary-dark hover:underline"
                        >
                          {expanded ? 'ย่อ ▲' : 'รายละเอียด ▼'}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-b border-slate-100 bg-slate-50/60">
                        <td colSpan={8} className="px-4 py-4">
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                              <div className="text-xs font-semibold text-slate-500">ข้อความจากลูกค้า</div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                                {row.message || '(ไม่ได้กรอกข้อความเพิ่มเติม)'}
                              </p>
                              {row.contacted_by ? (
                                <p className="mt-3 text-xs text-slate-400">
                                  ติดต่อแล้วโดย {row.contacted_by}
                                  {row.contacted_at
                                    ? ` เมื่อ ${new Date(row.contacted_at).toLocaleString('th-TH')}`
                                    : ''}
                                </p>
                              ) : null}
                            </div>
                            <div>
                              <label className="form-label" htmlFor={`note-${row.id}`}>
                                โน้ตภายใน (ทีมงานเท่านั้น เห็นเฉพาะ Admin)
                              </label>
                              <textarea
                                id={`note-${row.id}`}
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                                rows={3}
                                className="form-input"
                                placeholder="เช่น โทรไม่ติด นัดโทรใหม่พรุ่งนี้บ่าย..."
                              />
                              <button
                                onClick={() => saveNote(row.id)}
                                disabled={busy}
                                className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                              >
                                {busy ? 'กำลังบันทึก...' : '💾 บันทึกโน้ต'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
