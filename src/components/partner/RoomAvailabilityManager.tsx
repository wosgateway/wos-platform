// src/components/partner/RoomAvailabilityManager.tsx
//
// Phase 2 ของ Hotel Pilot brief — ปฏิทิน availability ต่อห้อง/ต่อวัน
// (migration 117: public.room_availability). Pattern การเขียนตรงจาก
// browser ผ่าน supabase client เหมือน PackagesManager.tsx ทุกจุด —
// RLS policy "Partners can manage their own room availability" (join
// ผ่าน packages.partner_id) เป็นด่านคุมสิทธิ์จริง ไม่ใช่ code ฝั่งนี้
//
// ยังไม่เชื่อมกับ booking flow จริง (create_order_with_items ไม่เช็ค
// ตารางนี้) — ดูคอมเมนต์ header ของ migration 117 สำหรับเหตุผล เป็น
// ปฏิทินสำหรับพาร์ทเนอร์กรอกไว้อ้างอิง/วางแผนก่อน ยังไม่ block การจองจริง
'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';

interface RoomOption {
  id: string;
  title: string;
  original_price: number;
}

interface AvailabilityRow {
  id: string;
  package_id: string;
  date: string; // YYYY-MM-DD
  available_count: number;
  price_override: number | null;
}

// BUGFIX (code review ก่อน merge): ห้ามใช้ .toISOString() หลังทำ date
// arithmetic แบบ local time — d.setDate() เดินตาม local calendar day
// แต่ .toISOString() แปลงกลับเป็น UTC ซึ่งสำหรับ timezone ที่ล่วงหน้า UTC
// (เช่นไทย +7) เที่ยงคืน local ของวันถัดไปจะยังอยู่ใน "เมื่อวาน" ฝั่ง UTC
// ทำให้ทุกวันที่ที่คำนวณย้อนหลังไป 1 วันเสมอ และที่ร้ายกว่านั้น
// dateRange() เรียก addDaysISO(cur, 1) วนลูปเพื่อเลื่อนทีละวัน — เพราะบั๊กนี้
// addDaysISO(x, 1) จะคืนค่า "เท่าเดิม" เสมอ (ไม่ขยับ) ทำให้ลูปไม่เดินหน้า
// เลยจนชน guard 90 แถว กลายเป็นวันเดียวกันซ้ำ 90 ครั้งแทนที่จะเป็น 90 วัน
// ต่อเนื่องกัน — ยืนยันด้วยการรันจำลองด้วย TZ=Asia/Bangkok แล้ว
//
// แก้โดย format วันที่จาก local getFullYear/getMonth/getDate ตรงๆ แทน
// ไม่ผ่าน UTC เลยตลอดสาย
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO(): string {
  return toISODate(new Date());
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

// สร้าง array ของวันที่ทุกวันระหว่าง start ถึง end (inclusive) — จำกัด
// 90 วันกันพลาดกรอกช่วงยาวเกินไปจนยิง upsert เป็นพันแถวโดยไม่ตั้งใจ
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 90) {
    dates.push(cur);
    cur = addDaysISO(cur, 1);
    guard += 1;
  }
  return dates;
}

export function RoomAvailabilityManager({ partnerId }: { partnerId: string }) {
  const supabase = createClient();

  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [rangeStart, setRangeStart] = useState<string>(todayISO());
  const [rangeEnd, setRangeEnd] = useState<string>(addDaysISO(todayISO(), 6));
  const [bulkCount, setBulkCount] = useState<string>('');
  const [bulkPrice, setBulkPrice] = useState<string>('');
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  async function loadRooms() {
    const { data, error: fetchError } = await supabase
      .from('packages')
      .select('id, title, original_price')
      .eq('partner_id', partnerId)
      .order('title', { ascending: true });

    if (fetchError) {
      setError('โหลดรายชื่อห้องไม่สำเร็จ: ' + fetchError.message);
      return;
    }
    setRooms((data as RoomOption[]) ?? []);
    if (data && data.length > 0 && !selectedRoomId) {
      setSelectedRoomId(data[0].id);
    }
  }

  async function loadAvailability(roomId: string) {
    if (!roomId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('room_availability')
      .select('id, package_id, date, available_count, price_override')
      .eq('package_id', roomId)
      .gte('date', todayISO())
      .order('date', { ascending: true });

    setLoading(false);

    if (fetchError) {
      setError('โหลดปฏิทินไม่สำเร็จ: ' + fetchError.message);
      return;
    }
    setRows((data as AvailabilityRow[]) ?? []);
  }

  useEffect(() => {
    loadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedRoomId) loadAvailability(selectedRoomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId]);

  const rowsByDate = useMemo(() => {
    const map = new Map<string, AvailabilityRow>();
    rows.forEach((r) => map.set(r.date, r));
    return map;
  }, [rows]);

  async function handleApplyRange(e: React.FormEvent) {
    e.preventDefault();
    setApplyMsg(null);

    if (!selectedRoomId) {
      setApplyMsg('เลือกห้องก่อน');
      return;
    }
    if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) {
      setApplyMsg('ช่วงวันที่ไม่ถูกต้อง');
      return;
    }
    if (bulkCount === '' || Number(bulkCount) < 0) {
      setApplyMsg('กรอกจำนวนห้องว่างให้ถูกต้อง (0 ขึ้นไป)');
      return;
    }

    const dates = dateRange(rangeStart, rangeEnd);
    const payload = dates.map((date) => ({
      package_id: selectedRoomId,
      date,
      available_count: Number(bulkCount),
      price_override: bulkPrice ? Number(bulkPrice) : null,
    }));

    setApplying(true);
    const { error: upsertError } = await supabase
      .from('room_availability')
      .upsert(payload, { onConflict: 'package_id,date' });
    setApplying(false);

    if (upsertError) {
      setApplyMsg('บันทึกไม่สำเร็จ: ' + upsertError.message);
      return;
    }

    setApplyMsg(`✅ อัปเดต ${dates.length} วันเรียบร้อย`);
    loadAvailability(selectedRoomId);
  }

  async function handleInlineUpdate(date: string, field: 'available_count' | 'price_override', value: string) {
    if (!selectedRoomId) return;

    const existing = rowsByDate.get(date);

    // BUGFIX (code review ก่อน merge): input เป็น uncontrolled
    // (defaultValue) และ onBlur ยิง upsert ทุกครั้งไม่ว่าค่าจะเปลี่ยนจริง
    // หรือไม่ — คลิกเข้าไปในช่องที่ "ยังไม่ตั้งค่า" (ไม่มีแถวใน DB) แล้ว
    // คลิกออกโดยไม่พิมพ์อะไรเลย จะได้ value === '' -> Number('' || 0) = 0
    // แล้วสร้างแถวใหม่ available_count: 0 ("เต็ม/ห้องหมด") ทั้งที่พาร์ทเนอร์
    // ไม่ได้ตั้งใจแตะช่องนี้เลย — เช็คก่อนว่าค่าที่ blur ต่างจากค่าที่โชว์อยู่
    // เดิมจริงไหม (ทั้งกรณีมีแถวเดิมและกรณียังไม่มีแถว/ค่าว่าง) ถ้าเหมือนเดิม
    // ให้ข้าม ไม่ยิง upsert เลย
    const previousDisplayed =
      field === 'available_count'
        ? existing?.available_count != null
          ? String(existing.available_count)
          : ''
        : existing?.price_override != null
          ? String(existing.price_override)
          : '';

    if (value.trim() === previousDisplayed) {
      return;
    }

    const payload = {
      package_id: selectedRoomId,
      date,
      available_count: field === 'available_count' ? Number(value || 0) : existing?.available_count ?? 0,
      price_override:
        field === 'price_override' ? (value ? Number(value) : null) : existing?.price_override ?? null,
    };

    const { error: upsertError } = await supabase
      .from('room_availability')
      .upsert(payload, { onConflict: 'package_id,date' });

    if (upsertError) {
      alert('บันทึกไม่สำเร็จ: ' + upsertError.message);
      return;
    }
    loadAvailability(selectedRoomId);
  }

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);
  // แสดง 30 วันถัดไปเสมอ แม้บางวันยังไม่มีแถวใน DB (ตีความว่า "ยังไม่ตั้งค่า"
  // ไม่ใช่ "0 ห้องว่าง" — ดูคอมเมนต์ available_count ใน migration 117)
  const next30Days = useMemo(() => dateRange(todayISO(), addDaysISO(todayISO(), 29)), []);

  if (rooms.length === 0 && !loading) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
        ยังไม่มีห้องพัก — ไปที่เมนู &quot;โปรแกรม&quot; เพื่อสร้างห้องก่อน แล้วค่อยกลับมาตั้งค่าห้องว่างที่นี่
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>
      ) : null}

      <div>
        <label className="form-label">เลือกห้อง</label>
        <select
          className="form-input max-w-sm"
          value={selectedRoomId}
          onChange={(e) => setSelectedRoomId(e.target.value)}
        >
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
      </div>

      {/* Bulk apply — ตั้งค่าทีเดียวทั้งช่วงวันที่ แบบเดียวกับ Rate and
          Allotment ของ Agoda YCS: เลือกห้อง → เลือกช่วงวัน → กรอกจำนวน/ราคา */}
      <form onSubmit={handleApplyRange} className="rounded-2xl border border-slate-100 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">ตั้งค่าห้องว่างเป็นช่วง</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="form-label">จากวันที่</label>
            <input
              type="date"
              className="form-input"
              value={rangeStart}
              min={todayISO()}
              onChange={(e) => setRangeStart(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">ถึงวันที่</label>
            <input
              type="date"
              className="form-input"
              value={rangeEnd}
              min={rangeStart}
              onChange={(e) => setRangeEnd(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">จำนวนห้องว่าง/วัน *</label>
            <input
              type="number"
              min={0}
              className="form-input"
              value={bulkCount}
              onChange={(e) => setBulkCount(e.target.value)}
              placeholder="เช่น 3"
            />
          </div>
          <div>
            <label className="form-label">ราคาพิเศษช่วงนี้ (ถ้ามี)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className="form-input"
              value={bulkPrice}
              onChange={(e) => setBulkPrice(e.target.value)}
              placeholder={selectedRoom ? `เว้นว่าง = ${formatTHB(selectedRoom.original_price)}` : 'เว้นว่าง = ราคาปกติ'}
            />
          </div>
        </div>
        {applyMsg ? <p className="text-xs text-slate-500">{applyMsg}</p> : null}
        <button type="submit" disabled={applying} className="btn-primary text-sm disabled:opacity-60">
          {applying ? '⏳ กำลังบันทึก...' : '💾 บันทึกช่วงนี้'}
        </button>
      </form>

      {/* ปฏิทิน 30 วันถัดไป — แก้ทีละวันได้ตรงนี้ */}
      <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white">
        <table className="w-full min-w-[500px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-2">วันที่</th>
              <th className="px-4 py-2">ห้องว่าง</th>
              <th className="px-4 py-2">ราคา (ถ้าต่างจากปกติ)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  กำลังโหลด...
                </td>
              </tr>
            ) : (
              next30Days.map((date) => {
                const row = rowsByDate.get(date);
                return (
                  <tr key={date} className="border-b border-slate-50">
                    <td className="px-4 py-2 text-slate-600">{date}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        className="form-input w-24"
                        defaultValue={row?.available_count ?? ''}
                        placeholder="ยังไม่ตั้งค่า"
                        onBlur={(e) => handleInlineUpdate(date, 'available_count', e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="form-input w-32"
                        defaultValue={row?.price_override ?? ''}
                        placeholder="ราคาปกติ"
                        onBlur={(e) => handleInlineUpdate(date, 'price_override', e.target.value)}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
