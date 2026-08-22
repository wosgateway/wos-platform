-- เพิ่มสวิตช์เปิด/ปิดการแสดงผลของแพ็กเกจ แยกจาก status (workflow อนุมัติ)
-- แอดมินจะปิดการแสดงผลแพ็กเกจที่ "published" แล้วได้โดยไม่ต้องเปลี่ยนสถานะอนุมัติ
-- (ไม่ต้อง reject / archive แล้วต้องอนุมัติใหม่ทีหลัง)

alter table public.packages
  add column if not exists is_active boolean not null default true;

comment on column public.packages.is_active is
  'สวิตช์เปิด/ปิดการแสดงผลของแอดมิน แยกจาก status (approval workflow) — false = ระงับการแสดงบนหน้าเว็บชั่วคราว โดยไม่กระทบสถานะอนุมัติ';

-- แพ็กเกจเก่าที่มีอยู่แล้วทั้งหมดจะเป็น is_active = true อัตโนมัติจาก default ด้านบน
