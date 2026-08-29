# WOS Platform — Security Audit & Fix Summary

**สถานะ:** ✅ เสร็จสมบูรณ์ทั้งหมด (STEP 0-8)
**Scope:** RLS/Multi-tenant isolation, Payment integrity, Public-facing token surface, Authorization matrix, Schema drift, Testing, Production deploy

---

## 1. จุดเริ่มต้น — Build Error

**ปัญหา:** `npm run build` ล้มเหลว
```
Module not found: Can't resolve '@/lib/booking/upload-attachment'
```
**สาเหตุ:** ไฟล์จริงชื่อ `upload-booking-attachment.ts` แต่ `BookingForm.tsx` / `JourneyBookingForm.tsx` import จาก `upload-attachment.ts` — filename mismatch เฉยๆ ไม่ใช่ logic ผิด
**แก้:** rename ไฟล์ให้ตรงกับ import path → build ผ่าน

---

## 2. Security Audit — 4 STEP หลัก (เรียงตามความเสี่ยง)

### STEP 1 — RLS / Multi-tenant Isolation 🔴
ตรวจ RLS policy ของทุก table ที่มี `organization_id`/`partner_id` และ storage bucket
**Fix migrations:**
- `061_dedupe_partner_images_public_read_policy.sql`
- `064_drop_orphaned_order_items_partner_update_policy.sql`
- `065_partner_own_profile_rpc.sql` — ปิดช่อง partner แก้ profile ตัวเองตรงๆ (column-level ที่ RLS row-level เอาไม่อยู่) เปลี่ยนเป็น RPC `partner_update_own_profile`
- `067_dedupe_organizations_select_policy.sql`

**Companion code:** `src/app/api/partner/profile/route.ts` (ใหม่) + `CompanyProfile.tsx` (ใหม่) เรียก RPC แทนการ update ตรง

### STEP 2 — Payment / Race Condition 🔴
ตรวจว่า client ปลอมยอดเงินได้ไหม, verify payment พร้อมกัน 2 ครั้งยอดเกินไหม
**Fix migration:**
- `060_fix_partner_verify_payment_ownership.sql` — เพิ่ม ownership check ใน `partner_verify_payment` RPC (เดิม partner A verify payment ของ partner B ได้ถ้ารู้ payment id)

**Companion code:** `src/app/api/partner/payments/[id]/verify/route.ts` — อัปเดตให้เรียก RPC ด้วย signature ใหม่ (4 args, `p_partner_id` มาจาก server-side session ไม่ใช่ client)

### STEP 3 — Public-facing Surface (Quote/my-trip) 🔴
ตรวจว่ารู้ `orderNumber` คนอื่นแล้วเข้าดู/แก้อะไรได้ไหม, token เดาง่ายไหม
**Fix:** สร้าง shared helper ใหม่ `src/lib/orders/authorize-order.ts`
- `loadAuthorizedOrder()` — รวม logic เช็ค `payment_access_token` ไว้จุดเดียว
- `tokensMatch()` — **timing-safe comparison** (`crypto.timingSafeEqual`) แทน `!==` ตรงๆ ป้องกัน timing side-channel attack
- `omitToken()` — กัน token หลุดไปกับ JSON response

**ใช้ helper นี้ครบทั้ง 6 public routes:**
`quote/route.ts`, `confirm/route.ts`, `payments/route.ts`, `upload-slip-url/route.ts`, `orders/[orderNumber]/attachment/route.ts`, `orders/[orderNumber]/attachment-upload-url/route.ts` (2 ตัวหลังแก้ทีหลังหลังพบว่าเขียน token check ซ้ำเองแบบไม่ timing-safe)

**Fix migrations (storage hardening, part of same surface):**
- `066_storage_upload_stopgap_hardening.sql`
- `068_payment_slips_drop_anon_upload_policy.sql` — ย้ายเป็น signed-upload-URL flow แทน anon insert policy
- `069_booking_attachments_drop_anon_upload.sql` — เดียวกันสำหรับ booking attachments

**Companion code:** flow ใหม่ 3 ขั้น (สร้าง order → ขอ signed URL จาก server → upload ตรงไป Supabase Storage) แทนที่ anon เขียนตรงเข้า bucket ได้เลย

### STEP 4 — Authorization Matrix 🟠
ตรวจ RPC `EXECUTE` privilege ว่า `anon` เรียก RPC ที่แก้เงินได้ไหม
**ผล:** ตรวจครบ — RPC ที่แตะเงิน/สิทธิ์ทั้งหมดเป็น `service_role` only ถูกต้อง มีแค่ helper functions (`current_user_*_id`) และ public search (`nearby_partners`) ที่ grant ให้ `anon`/`authenticated` ซึ่งถูกต้องตามดีไซน์

---

## 3. STEP 5 — Schema Drift + Data Consistency 🟡

**Fix migration:**
- `063_drop_legacy_tables.sql` — ลบ table ที่เลิกใช้แล้ว (`bookings`, `partner_bookings`, `patients`, `payment_attachments`)

**ตรวจ:** grep ทั้ง `src/` ยืนยันไม่มี live reference เหลือ (มีแค่ comment อธิบายว่าลบไปแล้ว), `lib/partner/orders.ts` เปลี่ยนไปใช้ query ใหม่แทน `partner_bookings`

**State machine ของ order status:** ตรวจแล้วว่ามี `ALLOWED_TRANSITIONS` guard อยู่แล้วใน `admin/orders/[id]/route.ts` (atomic `.eq('status', fromStatus)` กัน race + กันข้ามขั้นตอนผิด) — ไม่ต้องแก้เพิ่ม

---

## 4. STEP 6 — Fix Migrations ทั้งหมด (060-069)

| Migration | เรื่อง |
|---|---|
| 060 | Partner verify payment ownership check |
| 061 | Dedupe partner images public-read policy |
| 063 | Drop legacy tables (bookings, partner_bookings, patients, payment_attachments) |
| 064 | Drop orphaned order_items partner-update policy |
| 065 | Partner own-profile RPC |
| 066 | Storage upload stopgap hardening |
| 067 | Dedupe organizations select policy |
| 068 | Payment slips — drop anon upload policy |
| 069 | Booking attachments — drop anon upload |

เขียนแยกไฟล์ต่อท้ายทั้งหมด ไม่แก้ migration เดิม ตามกติกา

---

## 5. STEP 7 — Test จริงบน DB

ทดสอบ payment flow ทั้งหมดบนข้อมูลจริง พร้อมหลักฐาน before/after:
- Partner verify/reject payment — ownership check, atomic claim, race condition protection: **PASS**
- Admin verify whole-order payment → deposit/balance/order status คำนวณถูกต้อง: **PASS**
- Admin reject → status, reason, timestamp: **PASS**
- Customer token access (valid/invalid/missing): **PASS** (401/403 ตามกรณี)

**Finding ที่เจอระหว่างเทส:**
> **ADMIN-REJECT-001** — `admin/payments/[id]/reject/route.ts` ไม่บันทึก `verified_by` (partner-side reject route ทำถูกอยู่แล้ว แต่ admin-side ตกหล่น) → เป็น auditability gap ไม่ใช่ security bug

**Fix:** เพิ่ม `verified_by: auth.user.id` ในไฟล์ admin reject (1 บรรทัด, copy pattern จากไฟล์ที่ถูกต้องอยู่แล้ว) → ปิด finding

---

## 6. STEP 8 — Production Readiness

- ✅ `npm run build` ผ่าน (63 static pages, ทุก API route compile สำเร็จ)
- ✅ Migration 060-069 รันขึ้น production แล้ว
- ✅ Deploy เสร็จสิ้น

---

## 7. ไฟล์ที่แก้/สร้างใหม่ทั้งหมด

**SQL (ใหม่):** `sql/060-069_*.sql` (9 ไฟล์)

**Code แก้ไข:**
- `src/lib/orders/authorize-order.ts` (ใหม่ — shared token auth helper)
- `src/app/api/quote/[orderNumber]/route.ts`
- `src/app/api/quote/[orderNumber]/confirm/route.ts`
- `src/app/api/quote/[orderNumber]/payments/route.ts`
- `src/app/api/quote/[orderNumber]/upload-slip-url/route.ts` (ใหม่)
- `src/app/api/orders/[orderNumber]/attachment-upload-url/route.ts` (ใหม่)
- `src/app/api/orders/[orderNumber]/attachment/route.ts` (ใหม่)
- `src/app/api/partner/payments/[id]/verify/route.ts`
- `src/app/api/partner/profile/route.ts` (ใหม่)
- `src/app/api/admin/payments/[id]/reject/route.ts`
- `src/lib/booking/upload-attachment.ts` (rename จาก upload-booking-attachment.ts)
- `src/lib/partner/orders.ts`
- `src/components/BookingForm.tsx`
- `src/components/JourneyBookingForm.tsx`
- `src/components/CompanyProfile.tsx` (ใหม่)
- `src/app/[locale]/my-trip/[orderNumber]/payment/page.tsx`

---

## สรุปผลลัพธ์

| หมวด | ก่อน | หลัง |
|---|---|---|
| Multi-tenant isolation | มีช่องโหว่ column-level bypass RLS | ปิดผ่าน RPC + policy dedupe |
| Payment ownership | Partner A verify payment ของ Partner B ได้ | ตรวจ ownership ทุก RPC |
| Public token check | เขียนซ้ำหลายจุด, บางจุด `!==` (timing leak) | รวมจุดเดียว, timing-safe ทุก route |
| File upload | anon เขียนตรงเข้า storage bucket ได้ | signed-upload-URL flow, ปิด anon insert |
| Legacy schema | 4 table ค้าง ไม่มีใครใช้ | ลบแล้ว ยืนยันไม่มี reference เหลือ |
| Audit trail (reject) | ไม่รู้ว่า admin คนไหน reject | บันทึก `verified_by` ครบ |

**Audit รอบนี้ปิดครบทุก finding ที่พบ (🔴🟠🟡) ไม่มีรายการค้าง**
