'use client';

// src/components/admin/TransportPricingManager.tsx
//
// Admin editor for public.transport_vehicle_pricing (migration 081) —
// the "starting from ฿X" hint shown next to the vehicleType picker on
// the Transport booking step (BookingForm.tsx / JourneyBookingForm.tsx).
// This is display-only pricing, not a bound price: the real fare is
// still quoted by the team after a partner/vehicle is assigned (see
// priceBreakdown in both booking forms, which excludes transport from
// the total for exactly this reason). Row set is fixed to the 4
// vehicleType values the booking form offers — no add/delete here, see
// the API route's header comment.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface PricingRow {
  vehicle_type: string;
  starting_price: number;
  currency: string;
  is_active: boolean;
}

// Keep labels/order in sync with VehicleType in BookingForm.tsx /
// JourneyBookingForm.tsx and fields.vehicleType* in messages/th.json.
const VEHICLE_LABELS: Record<string, string> = {
  sedan: '🚗 รถเก๋ง',
  suv: '🚙 SUV',
  vip_van: '🚐 VIP Van',
  medical_transport: '🚑 รถพยาบาล/รถส่งต่อผู้ป่วย',
};
const VEHICLE_ORDER = ['sedan', 'suv', 'vip_van', 'medical_transport'];

export function TransportPricingManager() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  // Per-row editable draft value, keyed by vehicle_type, so typing in
  // one row's price input doesn't need a full round-trip per keystroke.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingType, setSavingType] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/admin/transport-vehicle-pricing', { cache: 'no-store' });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'โหลดข้อมูลไม่สำเร็จ');
      const pricing: PricingRow[] = result.pricing ?? [];
      setRows(pricing);
      setDrafts(Object.fromEntries(pricing.map((r) => [r.vehicle_type, String(r.starting_price)])));
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sortedRows = [...rows].sort(
    (a, b) => VEHICLE_ORDER.indexOf(a.vehicle_type) - VEHICLE_ORDER.indexOf(b.vehicle_type)
  );

  async function savePrice(vehicleType: string) {
    const raw = drafts[vehicleType];
    const price = Number(raw);
    if (raw === undefined || raw.trim() === '' || !Number.isFinite(price) || price < 0) {
      setRowError((prev) => ({ ...prev, [vehicleType]: 'ราคาต้องเป็นตัวเลข 0 ขึ้นไป' }));
      return;
    }
    setSavingType(vehicleType);
    setRowError((prev) => ({ ...prev, [vehicleType]: '' }));
    try {
      const res = await fetch('/api/admin/transport-vehicle-pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_type: vehicleType, starting_price: price }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'บันทึกไม่สำเร็จ');
      setRows((prev) => prev.map((r) => (r.vehicle_type === vehicleType ? result.pricing : r)));
    } catch (e) {
      setRowError((prev) => ({
        ...prev,
        [vehicleType]: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ',
      }));
    } finally {
      setSavingType(null);
    }
  }

  async function toggleActive(row: PricingRow) {
    setSavingType(row.vehicle_type);
    try {
      const res = await fetch('/api/admin/transport-vehicle-pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_type: row.vehicle_type, is_active: !row.is_active }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error();
      setRows((prev) => prev.map((r) => (r.vehicle_type === row.vehicle_type ? result.pricing : r)));
    } catch {
      setListError('เปลี่ยนสถานะไม่สำเร็จ');
    } finally {
      setSavingType(null);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">ราคาเริ่มต้นรถขนส่ง</h2>
        <p className="mt-1 text-xs text-slate-400">
          ราคานี้เป็นแค่ตัวเลข &quot;เริ่มต้น&quot; ที่โชว์ให้ลูกค้าดูตอนเลือกประเภทรถ ไม่ใช่ราคาผูกมัด —
          ราคาจริงทีมงานจะเสนอให้หลังจัดพาร์ทเนอร์แล้ว ปิดการแสดงผล (ปิดใช้งาน) แล้วจะไม่มี hint ราคาโชว์ในหน้าจองสำหรับรถประเภทนั้น
        </p>
      </div>

      {listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{listError}</div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">กำลังโหลด...</p>
      ) : sortedRows.length === 0 ? (
        <p className="text-sm text-slate-400">
          ยังไม่มีข้อมูลราคา — ต้องรัน migration 081_transport_vehicle_pricing.sql บนฐานข้อมูลก่อน
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">ประเภทรถ</th>
                <th className="px-4 py-2">ราคาเริ่มต้น (บาท)</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.vehicle_type} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {VEHICLE_LABELS[row.vehicle_type] ?? row.vehicle_type}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        className="form-input w-28"
                        value={drafts[row.vehicle_type] ?? ''}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [row.vehicle_type]: e.target.value }))
                        }
                      />
                      <button
                        onClick={() => savePrice(row.vehicle_type)}
                        disabled={savingType === row.vehicle_type}
                        className="btn-primary px-3 py-1.5 text-xs"
                      >
                        {savingType === row.vehicle_type ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          'บันทึก'
                        )}
                      </button>
                    </div>
                    {rowError[row.vehicle_type] ? (
                      <p className="mt-1 text-xs text-rose-600">{rowError[row.vehicle_type]}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        row.is_active ? 'bg-primary-light text-primary-dark' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {row.is_active ? 'แสดงอยู่' : 'ปิดการแสดงผล'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => toggleActive(row)}
                      disabled={savingType === row.vehicle_type}
                      className="text-xs font-medium text-slate-500"
                    >
                      {row.is_active ? 'ปิดการแสดงผล' : 'เปิดการแสดงผล'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
