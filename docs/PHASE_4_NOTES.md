# Phase 4 — Transport: Vehicles (fleet) — สรุปสำหรับทีม

Milestone 2 (Transport ฝั่ง Supply), เฟสแรก ต่อจาก Milestone 1 (Hotel
Pilot, Phase 0-3) ที่ทดสอบผ่านและใช้งานจริงแล้ว

## สิ่งที่ทำ

| ไฟล์ | สถานะ | ทำอะไร |
|---|---|---|
| `sql/119_transport_partner_vehicles.sql` | ใหม่ | ตาราง `vehicles(partner_id, vehicle_type, name, plate, seats, quantity, is_active)` + RLS (partner เห็นเฉพาะของตัวเอง, admin เห็นหมด) + trigger กันไม่ให้ partner นอกหมวด Transport ใช้ตารางนี้ |
| `src/components/partner/VehiclesManager.tsx` | ใหม่ | ตาราง fleet ของ partner + ฟอร์ม เพิ่ม/แก้/ลบ (ประเภทรถ, ชื่อ, ทะเบียน, ที่นั่ง, จำนวน, เปิด/ปิดใช้งาน) |
| `src/app/[locale]/(partner-portal)/vehicles/page.tsx` | ใหม่ | หน้า `/vehicles` — gate ตาม `partnerCategory === 'Transport'` เหมือน `/availability` gate ตาม Hotel |
| `PartnerSidebar.tsx` | แก้ไข | เพิ่มเมนู "รถ" |

## หลักการที่ใช้ (สืบทอดจาก Phase 1-3)

- `vehicle_type` เป็น TEXT ธรรมดา ไม่มี CHECK constraint — ใช้ 5 ค่าเดิม
  ที่มีอยู่แล้ว (`sedan/suv/vip_van/medical_transport/other` จาก
  migration 037/081) ไม่สร้าง enum ใหม่ เพื่อให้ตรงกับสิ่งที่ลูกค้าเลือก
  ตอนจองจริง (`BookingForm.tsx`) — dropdown ใน `VehiclesManager.tsx`
  คือ source of truth ของค่าที่ควรใช้ ไม่ใช่ DB
- RLS join ตรงจาก `vehicles.partner_id` (ไม่ต้องผ่าน `packages` เหมือน
  `room_availability` เพราะ vehicles ไม่ได้ผูกกับ package)
- trigger `check_vehicles_transport_only` เป็นแบบเดียวกับ
  `check_room_availability_hotel_only` ใน migration 118 เป๊ะๆ
- ทุกจุดเขียนข้อมูลจากฝั่ง client (`handleSubmit`, `handleDelete` ใน
  `VehiclesManager.tsx`) เติม `.select('id')` + เช็ค 0 แถวตั้งแต่ต้น —
  เอาบทเรียนจากบั๊กที่เจอใน `PackagesManager.tsx` (update/delete 0 แถว
  ไม่ error) มาใช้เลย ไม่ต้องรอเจอปัญหาเดิมซ้ำ

## ยังไม่ทำ (ตั้งใจ, ตามแผน)

- **ยังไม่ผูกกับระบบจอง/มอบหมายงานใดๆ** — `vehicles` เป็นแค่ fleet
  inventory ให้ partner กรอกไว้อ้างอิง เหมือน `room_availability` ใน
  Phase 2 ที่ยังไม่ผูกกับ booking flow
- Phase 5 (Service Routes), Phase 6 (Partner Rate ต่อ Route/Vehicle),
  Phase 7 (Availability รถต่อวัน — `vehicle_availability`) ยังไม่เริ่ม
- Phase 8-9 (เปิดให้ partner จัดการ Drivers เอง + Job Queue) เป็นจุด
  เสี่ยงสุดของทั้งแผน เพราะแตะ RLS/engine ที่ production ใช้งานจริงอยู่
  (`drivers`, `trip_events`, `transport_assignments`) — ต้อง design
  ก่อนเริ่มเขียนโค้ด ไม่ควรรีบ

## ก่อน merge/deploy

เหมือน Phase 1-3: รัน migration บน staging ก่อนเสมอ (ตารางใหม่ + RLS
ใหม่ + trigger ใหม่ — พลาดจุดเดียวเสี่ยงข้อมูลข้ามพาร์ทเนอร์ได้เหมือนเดิม)
แล้วทดสอบเป็น Transport Partner:

1. Login ด้วย partner ที่ `category='Transport'` → ไปเมนู "รถ" →
   เพิ่มรถ เลือกประเภท ใส่ที่นั่ง/จำนวน → บันทึก → refresh เช็คว่าข้อมูลอยู่ครบ
2. แก้ไขรถที่เพิ่งสร้าง เปลี่ยนจำนวน/ปิดใช้งาน → บันทึก → เช็คว่าอัปเดตจริง
3. ลบรถ 1 คัน → เช็คว่าหายจากลิสต์และหายจาก DB จริง
4. Login ด้วย partner หมวดอื่น (เช่น Hotel) → เข้า `/vehicles` ตรงๆ ทาง
   URL → ต้องเจอข้อความ "เมนูนี้สำหรับพาร์ทเนอร์ประเภทขนส่ง..." ไม่ใช่หน้าเปล่าหรือ error
5. (ถ้าทำได้) ลองยิง insert ตรงผ่าน SQL ด้วย partner_id ของ partner
   หมวด Hotel ดูว่า trigger บล็อกจริง ("... belongs to a non-Transport
   partner ...")
