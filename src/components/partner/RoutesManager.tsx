// src/components/partner/RoutesManager.tsx
//
// Phase 5 ของ Milestone 2 (Transport Group) — จัดการเส้นทางให้บริการ
// (migration 121: public.transport_routes)
//
// สัญญา (ล็อกไว้ก่อนเขียน 121):
//   - ต้นทาง/ปลายทางเป็น code จาก public.transport_locations เท่านั้น
//     ห้ามมี free text / "อื่นๆ ระบุเอง" (ไม่มีคอลัมน์รองรับใน DB)
//   - เส้นทางมีทิศทาง: A→B กับ B→A เป็นคนละแถว
//   - ไม่มีราคา / round_trip / ประเภทรถ ในหน้านี้
//   - dropdown มาจาก DB (transport_locations) ไม่ hard-code
//
// Pattern เดียวกับ VehiclesManager: เรียก Supabase ตรงจาก client + RLS,
// และตรวจ 0 แถวหลัง update/delete (RLS กรองเงียบ ๆ ไม่ error)
'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface TransportLocation {
  code: string;
  name_th: string;
  sort_order: number;
}

interface TransportRoute {
  id: string;
  origin_code: string;
  destination_code: string;
  is_active: boolean;
  created_at: string;
}

interface RouteFormData {
  id: string | null;
  origin_code: string;
  destination_code: string;
  is_active: boolean;
}

const emptyForm: RouteFormData = {
  id: null,
  origin_code: '',
  destination_code: '',
  is_active: true,
};

const supabase = createClient();

// แปลง error ของ Postgres ให้พาร์ทเนอร์อ่านรู้เรื่อง (ไม่โชว์ข้อความดิบ)
function friendlyError(err: { code?: string; message: string }): string {
  if (err.code === '23505') return 'มีเส้นทางนี้อยู่แล้ว (ทิศทางเดียวกัน) — แก้ไขรายการเดิมแทน';
  if (err.code === '23514') return 'ต้นทางและปลายทางต้องแตกต่างกัน';
  if (err.code === '23503') return 'จุดรับ-ส่งที่เลือกไม่ถูกต้องหรือถูกปิดใช้งาน กรุณาเลือกใหม่';
  return err.message;
}

export function RoutesManager({ partnerId }: { partnerId: string }) {
  const [locations, setLocations] = useState<TransportLocation[]>([]);
  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState<RouteFormData>(emptyForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    const [locationsResult, routesResult] = await Promise.all([
      supabase
        .from('transport_locations')
        .select('code,name_th,sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('transport_routes')
        .select('id,origin_code,destination_code,is_active,created_at')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false }),
    ]);

    if (locationsResult.error) {
      setError('ไม่สามารถโหลดจุดรับ-ส่งได้: ' + locationsResult.error.message);
      setLoading(false);
      return;
    }
    if (routesResult.error) {
      setError('ไม่สามารถโหลดเส้นทางได้: ' + routesResult.error.message);
      setLoading(false);
      return;
    }

    setLocations(locationsResult.data ?? []);
    setRoutes(routesResult.data ?? []);
    setLoading(false);
  }, [partnerId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // จุดที่ถูกปิดใช้งานทีหลังยังต้องแสดงชื่อ/ค่าเดิมได้ — fallback เป็น code
  function locationLabel(code: string) {
    return locations.find((item) => item.code === code)?.name_th ?? code;
  }

  // ตอนแก้ไข: ถ้า code เดิมไม่อยู่ใน list (ถูกปิดใช้งาน) ให้ยังเลือกค่าเดิมได้
  function optionsFor(current: string) {
    if (current && !locations.some((l) => l.code === current)) {
      return [...locations, { code: current, name_th: current + ' (ปิดใช้งานแล้ว)', sort_order: 999 }];
    }
    return locations;
  }

  function openModal(route?: TransportRoute) {
    setFormError('');
    setForm(
      route
        ? {
            id: route.id,
            origin_code: route.origin_code,
            destination_code: route.destination_code,
            is_active: route.is_active,
          }
        : emptyForm
    );
    setModalOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');

    if (!form.origin_code || !form.destination_code) {
      setFormError('กรุณาเลือกต้นทางและปลายทาง');
      return;
    }
    if (form.origin_code === form.destination_code) {
      setFormError('ต้นทางและปลายทางต้องแตกต่างกัน');
      return;
    }

    setSaving(true);

    const payload = {
      partner_id: partnerId,
      origin_code: form.origin_code,
      destination_code: form.destination_code,
      is_active: form.is_active,
    };

    const result = form.id
      ? await supabase
          .from('transport_routes')
          .update(payload)
          .eq('id', form.id)
          .eq('partner_id', partnerId)
          .select('id')
      : await supabase.from('transport_routes').insert(payload).select('id');

    setSaving(false);

    if (result.error) {
      setFormError('บันทึกไม่สำเร็จ: ' + friendlyError(result.error));
      return;
    }
    if (!result.data || result.data.length === 0) {
      setFormError(
        form.id
          ? 'บันทึกไม่สำเร็จ: ไม่พบสิทธิ์ของคุณสำหรับเส้นทางนี้'
          : 'บันทึกไม่สำเร็จ: ไม่สามารถสร้างเส้นทางได้'
      );
      return;
    }

    setModalOpen(false);
    setForm(emptyForm);
    await loadData();
  }

  async function handleDelete(id: string) {
    if (!confirm('ลบเส้นทางนี้? การดำเนินการนี้ไม่สามารถกู้คืนได้')) return;

    const { data, error: deleteError } = await supabase
      .from('transport_routes')
      .delete()
      .eq('id', id)
      .eq('partner_id', partnerId)
      .select('id');

    if (deleteError) {
      alert('ลบไม่สำเร็จ: ' + friendlyError(deleteError));
      return;
    }
    if (!data || data.length === 0) {
      alert('ลบไม่สำเร็จ: ไม่พบสิทธิ์ของคุณสำหรับเส้นทางนี้');
      return;
    }
    await loadData();
  }

  const activeCount = routes.filter((route) => route.is_active).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4 text-sm text-slate-500">
          <span>เส้นทางทั้งหมด {routes.length}</span>
          <span className="text-emerald-600">เปิดใช้งาน {activeCount}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          >
            รีเฟรช
          </button>
          <button onClick={() => openModal()} className="btn-primary text-sm">
            + เพิ่มเส้นทาง
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">กำลังโหลด...</p>
      ) : routes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-500">ยังไม่มีเส้นทาง</p>
          <p className="mt-1 text-xs text-slate-400">
            เพิ่มต้นทางและปลายทางที่บริษัทให้บริการ
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">ต้นทาง</th>
                <th className="px-4 py-2">ปลายทาง</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr key={route.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {locationLabel(route.origin_code)}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {locationLabel(route.destination_code)}
                  </td>
                  <td className="px-4 py-3">
                    {route.is_active ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                        เปิดใช้งาน
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                        ปิดใช้งาน
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openModal(route)}
                      className="mr-3 text-xs text-primary-dark hover:underline"
                    >
                      แก้ไข
                    </button>
                    <button
                      onClick={() => handleDelete(route.id)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6"
          >
            <h3 className="text-lg font-bold text-slate-900">
              {form.id ? 'แก้ไขเส้นทาง' : 'เพิ่มเส้นทางใหม่'}
            </h3>

            {formError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
                {formError}
              </div>
            ) : null}

            <div>
              <label className="form-label">ต้นทาง *</label>
              <select
                className="form-input"
                value={form.origin_code}
                onChange={(event) =>
                  setForm({ ...form, origin_code: event.target.value })
                }
              >
                <option value="">เลือกต้นทาง</option>
                {optionsFor(form.origin_code).map((location) => (
                  <option key={location.code} value={location.code}>
                    {location.name_th}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">ปลายทาง *</label>
              <select
                className="form-input"
                value={form.destination_code}
                onChange={(event) =>
                  setForm({ ...form, destination_code: event.target.value })
                }
              >
                <option value="">เลือกปลายทาง</option>
                {optionsFor(form.destination_code).map((location) => (
                  <option key={location.code} value={location.code}>
                    {location.name_th}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) =>
                  setForm({ ...form, is_active: event.target.checked })
                }
                className="h-4 w-4 rounded border-slate-300 text-primary-dark focus:ring-primary"
              />
              เปิดใช้งานเส้นทางนี้
            </label>

            <p className="text-xs text-slate-400">
              หมายเหตุ: เส้นทางขาไปและขากลับเป็นคนละรายการ เช่น
              หนองคาย → เวียงจันทน์ และ เวียงจันทน์ → หนองคาย
            </p>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary text-sm disabled:opacity-60"
              >
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
