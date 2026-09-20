'use client';

// src/components/admin/DriversManager.tsx
//
// Admin — manage the drivers pool referenced by transport_assignments
// (migration 076). A driver with partner_id = null is a WOS shared-pool
// driver and can be assigned to any partner's transport event; a driver
// with partner_id set can only serve that partner's events (enforced
// DB-side by check_driver_partner_match). All reads/writes go through
// /api/admin/drivers — public.drivers RLS is service-role only.

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Phone, Plus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type DriverStatus = 'active' | 'inactive';

interface Driver {
  id: string;
  partner_id: string | null;
  name: string;
  phone: string | null;
  status: DriverStatus;
  line_user_id: string | null;
  partners: { id: string; name: string } | null;
}

interface PartnerOption {
  id: string;
  name: string;
}

interface FormState {
  id: string | null;
  name: string;
  phone: string;
  partner_id: string;
  status: DriverStatus;
  line_user_id: string;
}

const emptyForm: FormState = {
  id: null,
  name: '',
  phone: '',
  partner_id: '',
  status: 'active',
  line_user_id: '',
};

export function DriversManager() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | DriverStatus>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadDrivers() {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/admin/drivers', { cache: 'no-store' });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'โหลดข้อมูลไม่สำเร็จ');
      setDrivers(result.drivers ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDrivers();
    // public.partners allows platform-admin read directly (same as
    // PartnersManager.tsx) — no dedicated API route needed for a
    // plain id/name picker list. MUST use the 'admin' namespace to read
    // the same 'sb-wos-admin' session cookie AdminGate signs in under —
    // this is a plain SELECT so it'd still "work" unauthenticated (partners
    // has a public read policy), but a bare createClient() would silently
    // run as anon here, so match the pattern everywhere for consistency.
    const supabase = createClient('admin');
    supabase
      .from('partners')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        if (data) setPartners(data);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredDrivers = useMemo(() => {
    if (statusFilter === 'all') return drivers;
    return drivers.filter((d) => d.status === statusFilter);
  }, [drivers, statusFilter]);

  function openModal(driver?: Driver) {
    setFormError(null);
    if (driver) {
      setForm({
        id: driver.id,
        name: driver.name,
        phone: driver.phone ?? '',
        partner_id: driver.partner_id ?? '',
        status: driver.status,
        line_user_id: driver.line_user_id ?? '',
      });
    } else {
      setForm(emptyForm);
    }
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError('กรุณากรอกชื่อคนขับ');
      return;
    }
    if (form.line_user_id.trim() && !/^U[0-9a-f]{32}$/i.test(form.line_user_id.trim())) {
      setFormError('LINE User ID ต้องขึ้นต้นด้วย U ตามด้วยตัวอักษร/ตัวเลข 32 ตัว (ไม่ใช่ LINE OA ID หรือชื่อที่แสดง)');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        partner_id: form.partner_id || null,
        status: form.status,
        line_user_id: form.line_user_id.trim() || null,
      };
      const res = form.id
        ? await fetch(`/api/admin/drivers/${form.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/drivers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'บันทึกไม่สำเร็จ');
      setModalOpen(false);
      await loadDrivers();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(driver: Driver) {
    const nextStatus: DriverStatus = driver.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await fetch(`/api/admin/drivers/${driver.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error();
      await loadDrivers();
    } catch {
      setListError('เปลี่ยนสถานะไม่สำเร็จ');
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">
          คนขับ ({filteredDrivers.length}
          {filteredDrivers.length !== drivers.length ? ` / ${drivers.length}` : ''})
        </h2>
        <div className="flex gap-2">
          <button onClick={loadDrivers} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            รีเฟรช
          </button>
          <button onClick={() => openModal()} className="btn-primary flex items-center gap-1 text-sm">
            <Plus className="h-4 w-4" />
            เพิ่มคนขับ
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'active', 'inactive'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              statusFilter === s ? 'bg-primary/15 text-primary-dark' : 'border border-slate-200 text-slate-500'
            }`}
          >
            {s === 'all' ? 'ทั้งหมด' : s === 'active' ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
          </button>
        ))}
      </div>

      {listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{listError}</div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">กำลังโหลด...</p>
      ) : drivers.length === 0 ? (
        <p className="text-sm text-slate-400">ยังไม่มีคนขับในระบบ</p>
      ) : filteredDrivers.length === 0 ? (
        <p className="text-sm text-slate-400">ไม่พบคนขับตามตัวกรอง</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">ชื่อ</th>
                <th className="px-4 py-2">เบอร์โทร</th>
                <th className="px-4 py-2">สังกัด</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2">LINE</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">{d.name}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {d.phone ? (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" />
                        {d.phone}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {d.partners ? (
                      d.partners.name
                    ) : (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700">พูลกลาง WOS</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        d.status === 'active' ? 'bg-primary-light text-primary-dark' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {d.status === 'active' ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {d.line_user_id ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                        ผูกแล้ว
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">
                        ยังไม่ผูก
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openModal(d)} className="text-xs font-medium text-primary-dark">
                        แก้ไข
                      </button>
                      <button onClick={() => toggleStatus(d)} className="text-xs font-medium text-slate-500">
                        {d.status === 'active' ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center">
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">{form.id ? 'แก้ไขคนขับ' : 'เพิ่มคนขับ'}</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">ชื่อคนขับ</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="form-input"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">เบอร์โทร</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="form-input"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">สังกัดพาร์ทเนอร์</label>
                <select
                  value={form.partner_id}
                  onChange={(e) => setForm((f) => ({ ...f, partner_id: e.target.value }))}
                  className="form-input"
                >
                  <option value="">— พูลกลาง WOS (ใช้ได้ทุกพาร์ทเนอร์) —</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  ถ้าเลือกพาร์ทเนอร์ คนขับจะถูกจำกัดให้รับงานของพาร์ทเนอร์นั้นเท่านั้น
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">LINE User ID</label>
                <input
                  value={form.line_user_id}
                  onChange={(e) => setForm((f) => ({ ...f, line_user_id: e.target.value }))}
                  className="form-input font-mono text-xs"
                  placeholder="U1234567890abcdef1234567890abcdef"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  ใช้ส่งงาน (จุดรับ-จุดส่ง-เวลา-ผู้โดยสาร) ให้คนขับทาง LINE โดยตรง
                  ปกติระบบจะจับคู่อัตโนมัติจากเบอร์โทร — ใส่/แก้/ลบตรงนี้เฉพาะตอนจับคู่ผิดหรือยังไม่มีให้
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">สถานะ</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as DriverStatus }))}
                  className="form-input"
                >
                  <option value="active">ใช้งานอยู่</option>
                  <option value="inactive">ปิดใช้งาน</option>
                </select>
              </div>

              {formError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                  {formError}
                </div>
              ) : null}

              <button type="submit" disabled={saving} className="btn-primary w-full justify-center">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : form.id ? 'บันทึกการแก้ไข' : 'เพิ่มคนขับ'}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
