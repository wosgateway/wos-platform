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

const DEFAULT_COLORS = ['#0d7c66', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899'];

export function CompanyProfile({
  organizationId,
}: {
  organizationId: string;
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
    primaryColor: '#0d7c66',
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
      primaryColor: data.settings?.theme?.primaryColor || '#0d7c66',
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
    setUploading(type);
    setError(null);

    try {
      const path = `organizations/${organizationId}/${type}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage
        .from('partner-images')
        .upload(path, file);

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

    setSaving(false);

    if (updateError) {
      setError('บันทึกไม่สำเร็จ: ' + updateError.message);
      return;
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
