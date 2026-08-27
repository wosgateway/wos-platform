// src/components/partner/CompanyProfile.tsx
'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  cover_image_url: string | null;
  description: string | null;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  province: string | null;
  settings: {
    theme?: {
      primaryColor?: string;
      secondaryColor?: string;
      font?: string;
    };
    social?: {
      line?: string;
      whatsapp?: string;
      facebook?: string;
      instagram?: string;
    };
  } | null;
}

interface FormData {
  name: string;
  slug: string;
  description: string;
  website_url: string;
  phone: string;
  email: string;
  address: string;
  province: string;
  logo_url: string;
  cover_image_url: string;
  primaryColor: string;
  line: string;
  whatsapp: string;
  facebook: string;
  instagram: string;
}

const DEFAULT_COLORS = ['#5B8C6E', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899'];

// จำกัดขนาดไฟล์อัปโหลด — ป้องกัน partner อัปโหลดไฟล์ต้นฉบับขนาดใหญ่ผิดปกติ
// (เช่น PNG จากกล้อง 5-10MB) เข้ามาตรงๆ โดยไม่มีการกรองใดๆ เลย
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// ขนาดสูงสุดฝั่งที่ยาวที่สุดหลัง resize — พอสำหรับโชว์เต็มจอ retina
// โดยไม่ต้องเก็บไฟล์ต้นฉบับความละเอียดกล้อง (4000px+) ไว้เต็มๆ
const MAX_DIMENSION_PX = 1600;
const COMPRESSED_QUALITY = 0.82;

// GIF resize ผ่าน canvas จะทำให้ animation หายไป (เหลือเฟรมเดียว) จึงข้าม
// การ resize เฉพาะไฟล์ GIF แล้วอัปโหลดไฟล์ต้นฉบับตรงๆ (ยังผ่าน MIME/size
// check ด้านบนเหมือนเดิม จึงยังปลอดภัยอยู่)
async function resizeImage(file: File): Promise<File> {
  if (file.type === 'image/gif') return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height));

  // ไฟล์เล็กกว่าเกณฑ์อยู่แล้ว ไม่ต้อง resize ซ้ำให้คุณภาพเสียเปล่าๆ
  if (scale >= 1) {
    bitmap.close();
    return file;
  }

  const targetWidth = Math.round(bitmap.width * scale);
  const targetHeight = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  // PNG เก็บ format เดิมไว้ (รองรับพื้นหลังโปร่งใส เช่น โลโก้) ส่วนชนิดอื่น
  // แปลงเป็น JPEG เพื่อให้ได้ไฟล์เล็กสุด
  const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, COMPRESSED_QUALITY)
  );

  // toBlob ล้มเหลว (เบราว์เซอร์บางตัว/บางสถานการณ์) — ใช้ไฟล์เดิมแทนดีกว่าอัปโหลดไม่สำเร็จเลย
  if (!blob) return file;

  const newName = file.name.replace(/\.[^.]+$/, outputType === 'image/png' ? '.png' : '.jpg');
  return new File([blob], newName, { type: outputType });
}

// เฉพาะคอลัมน์ที่มีอยู่จริงทั้งใน organizations และ partners (legacy
// public directory table — ดู sql/006_legacy_directory_tables.sql)
// เท่านั้นที่ sync ข้ามได้ตรงๆ; website_url/phone/email/address/slug/
// settings ไม่มีคอลัมน์คู่กันฝั่ง partners จึงยังคงอยู่ใน organizations
// อย่างเดียวเหมือนเดิม
type PartnersSyncPayload = {
  name: string;
  description: string | null;
  province: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
};

export function CompanyProfile({
  organizationId,
  partnerId,
}: {
  organizationId: string;
  // id ของแถวใน public.partners ที่ branch นี้ผูกอยู่ (branches.partner_id)
  // เป็น null เมื่อแอดมินยังไม่ได้เชื่อม branch เข้ากับ listing สาธารณะ —
  // ในกรณีนั้นฟอร์มนี้จะบันทึกลง organizations ได้ตามปกติ แต่จะไม่มีผล
  // กับหน้าเว็บสาธารณะจนกว่าจะเชื่อม
  partnerId?: string | null;
}) {
  const supabase = createClient();
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);

  const [form, setForm] = useState<FormData>({
    name: '',
    slug: '',
    description: '',
    website_url: '',
    phone: '',
    email: '',
    address: '',
    province: '',
    logo_url: '',
    cover_image_url: '',
    primaryColor: '#5B8C6E',
    line: '',
    whatsapp: '',
    facebook: '',
    instagram: '',
  });

  async function loadOrganization() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single();

    setLoading(false);

    if (fetchError) {
      setError('โหลดข้อมูลไม่สำเร็จ: ' + fetchError.message);
      return;
    }

    setOrg(data);
    setForm({
      name: data.name || '',
      slug: data.slug || '',
      description: data.description || '',
      website_url: data.website_url || '',
      phone: data.phone || '',
      email: data.email || '',
      address: data.address || '',
      province: data.province || '',
      logo_url: data.logo_url || '',
      cover_image_url: data.cover_image_url || '',
      primaryColor: data.settings?.theme?.primaryColor || '#5B8C6E',
      line: data.settings?.social?.line || '',
      whatsapp: data.settings?.social?.whatsapp || '',
      facebook: data.settings?.social?.facebook || '',
      instagram: data.settings?.social?.instagram || '',
    });
  }

  useEffect(() => {
    loadOrganization();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleImageUpload(type: 'logo' | 'cover', file: File) {
    setError(null);

    // เช็ค MIME type จริงจากไฟล์ (ไม่ใช่แค่ accept="image/*" ที่กรองได้แค่
    // ฝั่ง UI — ผู้ใช้ยังเลือกไฟล์ผ่าน "All Files" หรือลาก-วางไฟล์ประเภท
    // อื่นเข้ามาได้อยู่ดีถ้าไม่เช็คตรงนี้)
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setError('รองรับเฉพาะไฟล์รูปภาพ JPEG, PNG, WEBP หรือ GIF เท่านั้น');
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`ไฟล์ใหญ่เกินไป (${(file.size / 1024 / 1024).toFixed(1)}MB) — จำกัดไม่เกิน 5MB`);
      return;
    }

    setUploading(type);

    try {
      // resize/compress ฝั่ง client ก่อนอัปโหลด — ลดขนาดไฟล์จริง (ไม่ใช่แค่
      // จำกัดเพดานที่ 5MB) ก่อนขึ้น Storage เพื่อลด bandwidth/พื้นที่เก็บ
      // และให้หน้าเว็บโหลดไวขึ้น; ถ้า resize ล้มเหลวไม่ว่าด้วยเหตุผลใด
      // (เบราว์เซอร์เก่า, ไฟล์เสีย ฯลฯ) ให้ fallback ไปใช้ไฟล์ต้นฉบับที่ผ่าน
      // การเช็ค MIME/size ด้านบนแล้วแทน ดีกว่าอัปโหลดไม่สำเร็จเลย
      let uploadFile: File;
      try {
        uploadFile = await resizeImage(file);
      } catch {
        uploadFile = file;
      }

      const path = `organizations/${organizationId}/${type}/${Date.now()}_${uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage
        .from('partner-images')
        .upload(path, uploadFile);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('partner-images').getPublicUrl(path);

      if (type === 'logo') {
        setForm((f) => ({ ...f, logo_url: data.publicUrl }));
      } else {
        setForm((f) => ({ ...f, cover_image_url: data.publicUrl }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploading(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);

    if (!form.name.trim()) {
      setError('กรุณากรอกชื่อองค์กร');
      setSaving(false);
      return;
    }

    const settings = {
      theme: {
        primaryColor: form.primaryColor,
      },
      social: {
        line: form.line.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        facebook: form.facebook.trim() || null,
        instagram: form.instagram.trim() || null,
      },
    };

    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || null,
      description: form.description.trim() || null,
      website_url: form.website_url.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      province: form.province.trim() || null,
      logo_url: form.logo_url.trim() || null,
      cover_image_url: form.cover_image_url.trim() || null,
      settings,
    };

    const { error: updateError } = await supabase
      .from('organizations')
      .update(payload)
      .eq('id', organizationId);

    if (updateError) {
      setSaving(false);
      setError('บันทึกไม่สำเร็จ: ' + updateError.message);
      return;
    }

    // Sync เข้า public.partners ด้วย — ถ้า branch นี้ถูกเชื่อมกับ listing
    // สาธารณะแล้ว (partnerId ไม่ null) มิฉะนั้นสิ่งที่ partner แก้ในฟอร์มนี้
    // จะไปอัปเดตแค่ organizations โดยไม่มีผลอะไรกับหน้าเว็บจริงเลย
    // (partners มีคอลัมน์น้อยกว่า organizations — sync ได้แค่ฟิลด์ที่มีคู่กัน)
    if (partnerId) {
      const partnersPayload: PartnersSyncPayload = {
        name: payload.name,
        description: payload.description,
        province: payload.province,
        logo_url: payload.logo_url,
        cover_image_url: payload.cover_image_url,
      };

      const { error: partnerSyncError } = await supabase
        .from('partners')
        .update(partnersPayload)
        .eq('id', partnerId);

      setSaving(false);

      if (partnerSyncError) {
        setError('บันทึกข้อมูลภายในสำเร็จ แต่ sync ไปหน้าเว็บสาธารณะไม่สำเร็จ: ' + partnerSyncError.message);
        return;
      }
    } else {
      setSaving(false);
    }

    setSuccess(true);
    loadOrganization();

    setTimeout(() => setSuccess(false), 3000);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-96 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (error && !org) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-600">
        {error}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {!partnerId && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          บัญชีนี้ยังไม่ถูกเชื่อมกับหน้า partner บนเว็บสาธารณะ — ข้อมูลและรูปที่บันทึกด้านล่างจะยังไม่แสดงบนเว็บจริง
          จนกว่าแอดมินจะเชื่อมสาขาของคุณเข้ากับ listing สาธารณะ
        </div>
      )}
      {/* Cover Image */}
      <div className="relative rounded-xl overflow-hidden bg-slate-100 h-48">
        {form.cover_image_url ? (
          <Image
            src={form.cover_image_url}
            alt="Cover"
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400">
            🖼️ รูปปก
          </div>
        )}
        <div className="absolute bottom-3 right-3">
          <label className="cursor-pointer bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-white transition-colors">
            {uploading === 'cover' ? '⏳ กำลังอัปโหลด...' : '📷 เปลี่ยนรูปปก'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleImageUpload('cover', e.target.files[0])}
              disabled={uploading === 'cover'}
            />
          </label>
        </div>
      </div>

      {/* Logo */}
      <div className="flex items-start gap-6 -mt-10 relative z-10 px-4">
        <div className="relative">
          <div className="relative w-24 h-24 rounded-2xl bg-white border-4 border-white shadow-card overflow-hidden">
            {form.logo_url ? (
              <Image
                src={form.logo_url}
                alt="Logo"
                fill
                sizes="96px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl text-slate-300">
                🏢
              </div>
            )}
          </div>
          <label className="absolute -bottom-2 -right-2 cursor-pointer bg-white rounded-full p-1.5 shadow-card border border-slate-200 hover:bg-slate-50 transition-colors">
            <span className="text-xs">📷</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleImageUpload('logo', e.target.files[0])}
              disabled={uploading === 'logo'}
            />
          </label>
        </div>
        <div className="flex-1 pt-10">
          <h2 className="text-xl font-bold text-slate-900">{form.name || 'องค์กรของคุณ'}</h2>
          <p className="text-sm text-slate-400">
            {form.slug ? `wos.asia/partner/${form.slug}` : 'ยังไม่มี slug'}
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-card p-6 space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-600">
            ✅ บันทึกข้อมูลสำเร็จ
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="form-label">ชื่อองค์กร *</label>
            <input
              className="form-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="เช่น โรงพยาบาลบางรัก"
            />
          </div>

          <div>
            <label className="form-label">Slug (URL)</label>
            <input
              className="form-input"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
              placeholder="bangrak-hospital"
            />
            <p className="mt-1 text-xs text-slate-400">
              ใช้ใน URL: wos.asia/partner/{form.slug || 'your-slug'}
            </p>
          </div>

          <div>
            <label className="form-label">จังหวัด</label>
            <input
              className="form-input"
              value={form.province}
              onChange={(e) => setForm({ ...form, province: e.target.value })}
              placeholder="กรุงเทพมหานคร"
            />
          </div>

          <div className="md:col-span-2">
            <label className="form-label">คำอธิบาย</label>
            <textarea
              className="form-input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="แนะนำองค์กรของคุณ..."
            />
          </div>

          <div>
            <label className="form-label">เบอร์โทร</label>
            <input
              className="form-input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="02-xxx-xxxx"
            />
          </div>

          <div>
            <label className="form-label">อีเมล</label>
            <input
              className="form-input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="contact@hospital.com"
            />
          </div>

          <div className="md:col-span-2">
            <label className="form-label">ที่อยู่</label>
            <input
              className="form-input"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="123 ถนนสุขุมวิท ..."
            />
          </div>

          <div className="md:col-span-2">
            <label className="form-label">เว็บไซต์</label>
            <input
              className="form-input"
              value={form.website_url}
              onChange={(e) => setForm({ ...form, website_url: e.target.value })}
              placeholder="https://www.hospital.com"
            />
          </div>
        </div>

        {/* Theme Settings */}
        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">🎨 ตั้งค่าธีม</h3>
          <div className="flex flex-wrap gap-3">
            {DEFAULT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setForm({ ...form, primaryColor: color })}
                className={`w-10 h-10 rounded-full border-2 transition-all ${
                  form.primaryColor === color ? 'border-slate-900 scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
            <input
              type="color"
              className="w-10 h-10 rounded-full border-2 border-slate-200 cursor-pointer p-0"
              value={form.primaryColor}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
            />
          </div>
        </div>

        {/* Social Links */}
        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">🔗 ช่องทางติดต่อ</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="form-label">LINE ID</label>
              <input
                className="form-input"
                value={form.line}
                onChange={(e) => setForm({ ...form, line: e.target.value })}
                placeholder="@hospital"
              />
            </div>
            <div>
              <label className="form-label">WhatsApp</label>
              <input
                className="form-input"
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="https://wa.me/66xxxxxxxxx"
              />
            </div>
            <div>
              <label className="form-label">Facebook</label>
              <input
                className="form-input"
                value={form.facebook}
                onChange={(e) => setForm({ ...form, facebook: e.target.value })}
                placeholder="https://facebook.com/..."
              />
            </div>
            <div>
              <label className="form-label">Instagram</label>
              <input
                className="form-input"
                value={form.instagram}
                onChange={(e) => setForm({ ...form, instagram: e.target.value })}
                placeholder="https://instagram.com/..."
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <button
            type="submit"
            disabled={saving}
            className="btn-primary text-sm disabled:opacity-60"
          >
            {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึกข้อมูล'}
          </button>
        </div>
      </div>
    </form>
  );
}
