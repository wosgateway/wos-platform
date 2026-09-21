'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface TransportLocation {
  code: string;
  name_th: string;
  name_en: string;
  name_lo: string;
  sort_order: number;
}

interface TransportRoute {
  id: string;
  origin_code: string | null;
  destination_code: string | null;
  origin_custom_name: string | null;
  destination_custom_name: string | null;
  is_active: boolean;
  created_at: string;
}

interface RouteFormData {
  id: string | null;
  origin_code: string;
  destination_code: string;
  origin_custom_name: string;
  destination_custom_name: string;
  is_active: boolean;
}

const CUSTOM_LOCATION = '__custom__';

const emptyForm: RouteFormData = {
  id: null,
  origin_code: '',
  destination_code: '',
  origin_custom_name: '',
  destination_custom_name: '',
  is_active: true,
};

const supabase = createClient();

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
        .select('code,name_th,name_en,name_lo,sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),

      supabase
        .from('transport_routes')
        .select(
          'id,origin_code,destination_code,origin_custom_name,destination_custom_name,is_active,created_at'
        )
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false }),
    ]);

    if (locationsResult.error) {
      setError(
        'ไม่สามารถโหลดจุดรับ-ส่งได้: ' + locationsResult.error.message
      );
      setLoading(false);
      return;
    }

    if (routesResult.error) {
      setError(
        'ไม่สามารถโหลดเส้นทางได้: ' + routesResult.error.message
      );
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

  function locationLabel(
    code: string | null,
    customName: string | null
  ) {
    if (code) {
      const location = locations.find((item) => item.code === code);
      return location ? location.name_th : code;
    }

    return customName?.trim() || 'ไม่ระบุสถานที่';
  }

  function openModal(route?: TransportRoute) {
    setFormError('');

    if (!route) {
      setForm(emptyForm);
      setModalOpen(true);
      return;
    }

    setForm({
      id: route.id,
      origin_code: route.origin_code ?? CUSTOM_LOCATION,
      destination_code: route.destination_code ?? CUSTOM_LOCATION,
      origin_custom_name: route.origin_custom_name ?? '',
      destination_custom_name: route.destination_custom_name ?? '',
      is_active: route.is_active,
    });

    setModalOpen(true);
  }

  function handleOriginChange(value: string) {
    setForm((current) => ({
      ...current,
      origin_code: value,
      origin_custom_name:
        value === CUSTOM_LOCATION ? current.origin_custom_name : '',
    }));
  }

  function handleDestinationChange(value: string) {
    setForm((current) => ({
      ...current,
      destination_code: value,
      destination_custom_name:
        value === CUSTOM_LOCATION ? current.destination_custom_name : '',
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');

    const originIsCustom = form.origin_code === CUSTOM_LOCATION;
    const destinationIsCustom =
      form.destination_code === CUSTOM_LOCATION;

    const originCustomName = form.origin_custom_name.trim();
    const destinationCustomName =
      form.destination_custom_name.trim();

    if (!form.origin_code || !form.destination_code) {
      setFormError('กรุณาเลือกต้นทางและปลายทาง');
      return;
    }

    if (originIsCustom && !originCustomName) {
      setFormError('กรุณาระบุชื่อต้นทาง');
      return;
    }

    if (destinationIsCustom && !destinationCustomName) {
      setFormError('กรุณาระบุชื่อปลายทาง');
      return;
    }

    if (
      originIsCustom &&
      destinationIsCustom &&
      originCustomName.toLowerCase() ===
        destinationCustomName.toLowerCase()
    ) {
      setFormError('ต้นทางและปลายทางต้องแตกต่างกัน');
      return;
    }

    if (
      !originIsCustom &&
      !destinationIsCustom &&
      form.origin_code === form.destination_code
    ) {
      setFormError('ต้นทางและปลายทางต้องแตกต่างกัน');
      return;
    }

    setSaving(true);

    const payload = {
      partner_id: partnerId,
      origin_code: originIsCustom ? null : form.origin_code,
      destination_code: destinationIsCustom
        ? null
        : form.destination_code,
      origin_custom_name: originIsCustom
        ? originCustomName
        : null,
      destination_custom_name: destinationIsCustom
        ? destinationCustomName
        : null,
      is_active: form.is_active,
    };

    const result = form.id
      ? await supabase
          .from('transport_routes')
          .update(payload)
          .eq('id', form.id)
          .eq('partner_id', partnerId)
          .select('id')
      : await supabase
          .from('transport_routes')
          .insert(payload)
          .select('id');

    setSaving(false);

    if (result.error) {
      setFormError('บันทึกไม่สำเร็จ: ' + result.error.message);
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
    if (!confirm('ลบเส้นทางนี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้')) {
      return;
    }

    const { data, error: deleteError } = await supabase
      .from('transport_routes')
      .delete()
      .eq('id', id)
      .eq('partner_id', partnerId)
      .select('id');

    if (deleteError) {
      alert('ลบไม่สำเร็จ: ' + deleteError.message);
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
          <span className="text-emerald-600">
            เปิดใช้งาน {activeCount}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          >
            รีเฟรช
          </button>

          <button
            onClick={() => openModal()}
            className="btn-primary text-sm"
          >
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
                <tr
                  key={route.id}
                  className="border-b border-slate-50 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {locationLabel(
                      route.origin_code,
                      route.origin_custom_name
                    )}
                  </td>

                  <td className="px-4 py-3 font-medium text-slate-800">
                    {locationLabel(
                      route.destination_code,
                      route.destination_custom_name
                    )}
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

            {/* Origin */}
            <div>
              <label className="form-label">ต้นทาง *</label>

              <select
                className="form-input"
                value={form.origin_code}
                onChange={(event) =>
                  handleOriginChange(event.target.value)
                }
              >
                <option value="">เลือกต้นทาง</option>

                {locations.map((location) => (
                  <option key={location.code} value={location.code}>
                    {location.name_th}
                  </option>
                ))}

                <option value={CUSTOM_LOCATION}>
                  อื่นๆ — ระบุเอง
                </option>
              </select>

              {form.origin_code === CUSTOM_LOCATION ? (
                <input
                  type="text"
                  className="form-input mt-2"
                  value={form.origin_custom_name}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      origin_custom_name: event.target.value,
                    })
                  }
                  placeholder="ระบุชื่อต้นทาง เช่น โรงแรม ABC"
                  maxLength={200}
                />
              ) : null}
            </div>

            {/* Destination */}
            <div>
              <label className="form-label">ปลายทาง *</label>

              <select
                className="form-input"
                value={form.destination_code}
                onChange={(event) =>
                  handleDestinationChange(event.target.value)
                }
              >
                <option value="">เลือกปลายทาง</option>

                {locations.map((location) => (
                  <option key={location.code} value={location.code}>
                    {location.name_th}
                  </option>
                ))}

                <option value={CUSTOM_LOCATION}>
                  อื่นๆ — ระบุเอง
                </option>
              </select>

              {form.destination_code === CUSTOM_LOCATION ? (
                <input
                  type="text"
                  className="form-input mt-2"
                  value={form.destination_custom_name}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      destination_custom_name: event.target.value,
                    })
                  }
                  placeholder="ระบุชื่อปลายทาง เช่น โรงพยาบาล ABC"
                  maxLength={200}
                />
              ) : null}
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      is_active: event.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-primary-dark focus:ring-primary"
                />

                เปิดใช้งานเส้นทางนี้
              </label>
            </div>

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
