// src/components/partner/VehiclesManager.tsx
//
// Phase 4 ของ Hotel/Transport Pilot brief (Milestone 2, Transport
// Group) — จัดการ fleet รถของพาร์ทเนอร์ (migration 119: public.vehicles)
// Pattern เดียวกับ PackagesManager.tsx ทุกจุด: เขียนตรงจาก browser ผ่าน
// supabase client, RLS policy "Partners can manage their own vehicles"
// เป็นด่านคุมสิทธิ์จริง ไม่ใช่ code ฝั่งนี้ — และใช้บทเรียนจากบั๊กที่เจอใน
// PackagesManager.handleSubmit/handleDelete (0 แถวถูกแก้ไข/ลบแต่ไม่ error)
// ตั้งแต่ต้น ด้วยการเติม .select('id') + เช็ค 0 แถวทุกจุดเขียนข้อมูล
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Vehicle {
  id: string;
  vehicle_type: string;
  name: string;
  plate: string | null;
  seats: number | null;
  quantity: number;
  is_active: boolean;
  created_at: string;
}

interface VehicleFormData {
  id: string | null;
  vehicle_type: string;
  name: string;
  plate: string;
  seats: string;
  quantity: string;
  is_active: boolean;
}

const emptyForm: VehicleFormData = {
  id: null,
  vehicle_type: 'sedan',
  name: '',
  plate: '',
  seats: '',
  quantity: '1',
  is_active: true,
};

// ค่าเดียวกับ VehicleType ใน BookingForm.tsx/JourneyBookingForm.tsx
// เป๊ะๆ (migration 037/081) — 'other' เป็น free-text ไม่มี label
// สำเร็จรูป ดู messages/th.json สำหรับ label ต้นฉบับที่ใช้ฝั่งลูกค้า
const VEHICLE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'sedan', label: '🚗 รถเก๋ง' },
  { value: 'suv', label: '🚙 SUV' },
  { value: 'vip_van', label: '🚐 VIP Van' },
  { value: 'medical_transport', label: '🚑 รถพยาบาล/รถส่งต่อผู้ป่วย' },
  { value: 'other', label: 'อื่นๆ' },
];

function vehicleTypeLabel(value: string): string {
  return VEHICLE_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function VehiclesManager({ partnerId }: { partnerId: string }) {
  const supabase = createClient();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<VehicleFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadVehicles() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false });

    setLoading(false);

    if (fetchError) {
      setError('โหลดข้อมูลไม่สำเร็จ: ' + fetchError.message);
      return;
    }

    setVehicles((data as Vehicle[]) ?? []);
  }

  useEffect(() => {
    loadVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openModal(vehicle?: Vehicle) {
    setFormError(null);
    if (vehicle) {
      setForm({
        id: vehicle.id,
        vehicle_type: vehicle.vehicle_type,
        name: vehicle.name,
        plate: vehicle.plate || '',
        seats: vehicle.seats ? String(vehicle.seats) : '',
        quantity: String(vehicle.quantity),
        is_active: vehicle.is_active,
      });
    } else {
      setForm(emptyForm);
    }
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.name.trim()) {
      setFormError('กรุณากรอกชื่อ/รายละเอียดรถ');
      return;
    }
    if (!form.quantity || Number(form.quantity) <= 0) {
      setFormError('กรุณากรอกจำนวนรถให้ถูกต้อง (มากกว่า 0)');
      return;
    }
    if (form.seats && Number(form.seats) <= 0) {
      setFormError('จำนวนที่นั่งต้องมากกว่า 0');
      return;
    }

    setSaving(true);

    const payload = {
      partner_id: partnerId,
      vehicle_type: form.vehicle_type,
      name: form.name.trim(),
      plate: form.plate.trim() || null,
      seats: form.seats ? Number(form.seats) : null,
      quantity: Number(form.quantity),
      is_active: form.is_active,
    };

    let result;
    if (form.id) {
      // BUGFIX pattern เดียวกับ PackagesManager.handleSubmit — ต้องมี
      // .select('id') ต่อท้ายเสมอ ไม่งั้น update ที่ .eq() กรองแล้วเจอ 0
      // แถว (partner_id ไม่ตรง) จะไม่ error เลย ปิด modal เหมือนสำเร็จ
      // ทั้งที่ไม่ได้เขียนอะไรลง DB จริง — ดูคอมเมนต์เต็มใน
      // PackagesManager.tsx สำหรับเคสที่เจอจริง (ห้อง Standard Double)
      result = await supabase
        .from('vehicles')
        .update(payload)
        .eq('id', form.id)
        .eq('partner_id', partnerId)
        .select('id');
    } else {
      result = await supabase.from('vehicles').insert(payload).select('id');
    }

    setSaving(false);

    if (result.error) {
      setFormError('บันทึกไม่สำเร็จ: ' + result.error.message);
      return;
    }

    if (!result.data || result.data.length === 0) {
      setFormError(
        form.id
          ? 'บันทึกไม่สำเร็จ: ไม่พบสิทธิ์แก้ไขรถคันนี้ (partner_id ของรถนี้อาจไม่ตรงกับบัญชีของคุณ) กรุณาติดต่อทีมงาน WOS ให้ตรวจสอบข้อมูล'
          : 'บันทึกไม่สำเร็จ: ไม่สามารถสร้างข้อมูลรถได้ กรุณาติดต่อทีมงาน WOS'
      );
      return;
    }

    setModalOpen(false);
    loadVehicles();
  }

  async function handleDelete(id: string) {
    if (!confirm('ลบรถคันนี้? การดำเนินการนี้ไม่สามารถกู้คืนได้')) return;

    const { data: deletedRows, error: deleteError } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', id)
      .eq('partner_id', partnerId)
      .select('id');

    if (deleteError) {
      alert('ลบไม่สำเร็จ: ' + deleteError.message);
      return;
    }

    if (!deletedRows || deletedRows.length === 0) {
      alert('ลบไม่สำเร็จ: ไม่พบสิทธิ์ลบรถคันนี้ (partner_id ของรถนี้อาจไม่ตรงกับบัญชีของคุณ) กรุณาติดต่อทีมงาน WOS');
      return;
    }

    loadVehicles();
  }

  const activeCount = vehicles.filter((v) => v.is_active).length;
  const totalUnits = vehicles.reduce((sum, v) => sum + v.quantity, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm text-slate-500">
          <span>รายการรถ {vehicles.length}</span>
          <span className="text-emerald-600">เปิดใช้งาน {activeCount}</span>
          <span>รวมทั้งหมด {totalUnits} คัน</span>
        </div>
        <div className="flex gap-2">
          <button onClick={loadVehicles} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            รีเฟรช
          </button>
          <button onClick={() => openModal()} className="btn-primary text-sm">
            + เพิ่มรถ
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">กำลังโหลด...</p>
      ) : vehicles.length === 0 ? (
        <p className="text-sm text-slate-400">ยังไม่มีข้อมูลรถ กด &quot;+ เพิ่มรถ&quot; เพื่อเริ่มต้น</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">รถ</th>
                <th className="px-4 py-2">ประเภท</th>
                <th className="px-4 py-2">ที่นั่ง</th>
                <th className="px-4 py-2">จำนวน</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{v.name}</div>
                    {v.plate && <div className="text-xs text-slate-400">🪧 {v.plate}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{vehicleTypeLabel(v.vehicle_type)}</td>
                  <td className="px-4 py-3 text-slate-600">{v.seats ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{v.quantity}</td>
                  <td className="px-4 py-3">
                    {v.is_active ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                        ✅ เปิดใช้งาน
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                        🚫 ปิดใช้งาน
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openModal(v)} className="mr-3 text-xs text-primary-dark hover:underline">
                      แก้ไข
                    </button>
                    <button onClick={() => handleDelete(v.id)} className="text-xs text-red-500 hover:underline">
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
            className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6"
          >
            <h3 className="text-lg font-bold text-slate-900">{form.id ? 'แก้ไขข้อมูลรถ' : 'เพิ่มรถใหม่'}</h3>

            {formError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="form-label">ชื่อ/รายละเอียดรถ *</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="เช่น Toyota Alphard คันที่ 1"
                />
              </div>

              <div>
                <label className="form-label">ประเภทรถ *</label>
                <select
                  className="form-input"
                  value={form.vehicle_type}
                  onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}
                >
                  {VEHICLE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">ใช้จับคู่กับประเภทรถที่ลูกค้าเลือกตอนจอง</p>
              </div>

              <div>
                <label className="form-label">ทะเบียนรถ</label>
                <input
                  className="form-input"
                  value={form.plate}
                  onChange={(e) => setForm({ ...form, plate: e.target.value })}
                  placeholder="เช่น กข 1234 กรุงเทพมหานคร"
                />
              </div>

              <div>
                <label className="form-label">จำนวนที่นั่ง</label>
                <input
                  type="number"
                  min={1}
                  className="form-input"
                  value={form.seats}
                  onChange={(e) => setForm({ ...form, seats: e.target.value })}
                  placeholder="เช่น 6"
                />
              </div>

              <div>
                <label className="form-label">จำนวนคัน *</label>
                <input
                  type="number"
                  min={1}
                  className="form-input"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  placeholder="เช่น 1"
                />
                <p className="mt-1 text-xs text-slate-400">
                  ถ้ามีรถรุ่น/สเปกเดียวกันหลายคัน ใส่จำนวนรวมได้เลยโดยไม่ต้องแยกแถว
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-primary-dark focus:ring-primary"
                  />
                  เปิดใช้งาน (พร้อมให้ทีมงาน WOS จัดคิวงานให้)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-60">
                {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
