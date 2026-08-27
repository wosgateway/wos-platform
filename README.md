# WOS Platform — Next.js Migration (in progress)

**สถานะ:** ก้อนที่ 4/5 เสร็จแล้ว — Scaffold, หน้า public ทั้งหมด (home/category/partner/program), booking form แบบ multi-step, และ `/admin` (Supabase Auth + จัดการพาร์ทเนอร์/แพ็กเกจ) ครบแล้ว
เหลือก้อนที่ 5: sitemap เต็มรูปแบบ + ทดสอบ `npm run build` จริง

## เริ่มต้นใช้งาน

```bash
npm install
cp .env.local.example .env.local
# แก้ .env.local ถ้าจำเป็น (ค่าเริ่มต้นตรงกับ js/main.js เดิม)
npm run dev
```

เปิด http://localhost:3000 — จะ redirect ไป `/th` (ภาษาเริ่มต้น) อัตโนมัติ
ลองเปลี่ยนเป็น `/en` หรือ `/lo` เพื่อดูภาษาอื่น

## สิ่งที่เปลี่ยนจากเว็บ static เดิม

| เดิม (static HTML) | ใหม่ (Next.js) |
|---|---|
| `SUPABASE_URL`/`SUPABASE_ANON_KEY` ฝังในทุกไฟล์ | อ่านจาก `.env.local` ที่เดียว (`src/lib/supabase/`) |
| `.lang-content[data-lang]` ซ่อน/โชว์ด้วย CSS | จริงเป็นคนละ URL ต่อภาษา (`/th`, `/lo`, `/en`) ผ่าน next-intl — Google index ถูกภาษา |
| `window.WOS_CATEGORIES` ใน main.js | `src/lib/categories.ts` (ข้อมูล) + `src/messages/*.json` (คำแปล) |
| `window.fetchPartners()` ฯลฯ ใน main.js | `src/lib/data.ts` — type-safe, รันฝั่ง server ได้ |
| Admin password ฝังโค้ด (แก้ไปแล้วในเวอร์ชัน static ล่าสุดเป็น Supabase Auth) | คงแนวทาง Supabase Auth เดิมไว้ ผ่าน middleware session refresh |

## โครงสร้างที่ทำแล้ว / ยังไม่ได้ทำ

- [x] `/category/[slug]` — รายชื่อพาร์ทเนอร์ในหมวดหมู่
- [x] `/partner/[id]` — รายละเอียดพาร์ทเนอร์ + แพ็กเกจ (พร้อม gallery แบบ interactive)
- [x] `/program/[id]` — รายละเอียดโปรแกรม + ปุ่มจอง
- [x] `/booking/[packageId]` — ฟอร์มจอง 3 ขั้นตอน (นัดหมาย → ข้อมูลติดต่อ → สรุป+ยืนยัน)
- [x] `/admin` — Supabase Auth gate + จัดการพาร์ทเนอร์ (CRUD) + จัดการแพ็กเกจ (CRUD)
  - **ยังไม่รวม:** แดชบอร์ดดูรายการจอง (bookings), ส่งสรุปผ่าน WhatsApp/Line, พิมพ์ใบสรุป — ฟีเจอร์เหล่านี้มีในไฟล์ static เดิม (`admin.html`) แต่ยังไม่ได้พอร์ตมา เพราะ scope เดิมที่ตกลงกันคือ "list/edit partners+packages, auth" — แจ้งได้ถ้าต้องการเพิ่ม
  - ลบไฟล์ขยะ (`test.text` ฯลฯ) และสำเนาเก่า `images/hero/booking.html` ออกจากไฟล์ static ต้นทางแล้ว
- [x] `public/sitemap.xml` — เพิ่มหน้า home 3 ภาษา + 6 หมวดหมู่แล้ว (`Disallow: /admin` ใน robots.txt ด้วย)
  - **ข้อจำกัด:** `/partner/[id]` และ `/program/[id]` เป็นหน้า dynamic ต่อ record ในฐานข้อมูล ใส่ตายตัวใน `public/sitemap.xml` ไม่ได้ — ถ้าต้องการให้ครบ ควรทำ `src/app/sitemap.ts` แบบ dynamic ที่ query Supabase มา generate เอง (ยังไม่ได้ทำ เพราะเป็นงานเพิ่มนอกขอบเขตที่ตกลงไว้)
- [ ] ยังไม่เคยรัน `npm run build` จริง (ไม่มีอินเทอร์เน็ตในแซนด์บ็อกซ์)

## ก่อนใช้งาน /admin

ต้องสร้างบัญชีทีมงานล่วงหน้าใน **Supabase Dashboard → Authentication → Users** ก่อน (อีเมล+รหัสผ่าน)
หน้า `/admin` จะรับ sign-in เท่านั้น ไม่สร้างบัญชีให้อัตโนมัติ
และต้องมี Storage bucket ชื่อ `partner-images` (public) สำหรับอัปโหลดรูปพาร์ทเนอร์/แพ็กเกจ (แยกจาก `booking-attachments` ที่ใช้ตอนจอง)

## หมายเหตุ

โปรเจกต์นี้เขียนโค้ดไว้ให้ครบแต่**ยังไม่ได้รัน `npm install`/ทดสอบจริง** เพราะสภาพแวดล้อมที่สร้างไฟล์นี้ไม่มีอินเทอร์เน็ต
กรุณารันทดสอบในเครื่องคุณก่อน แล้วแจ้งถ้ามี error เพื่อแก้ต่อได้
