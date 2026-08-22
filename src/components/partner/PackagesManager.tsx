// src/components/partner/PackagesManager.tsx
'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';

interface Package {
  id: string;
  title: string;
  description: string | null;
  original_price: number;
  special_price: number | null;
  is_promotion: boolean;
  duration: string | null;
  status: 'pending' | 'published' | 'rejected' | 'archived';
  is_active: boolean;
  image_url: string | null;
  created_at: string;
}

interface PackageFormData {
  id: string | null;
  title: string;
  description: string;
  original_price: string;
  special_price: string;
  is_promotion: boolean;
  duration: string;
  image_url: string;
}

const emptyForm: PackageFormData = {
  id: null,
  title: '',
  description: '',
  original_price: '',
  special_price: '',
  is_promotion: false,
  duration: '',
  image_url: '',
};

const STATUS_LABEL: Record<Package['status'], { text: string; className: string }> = {
  pending: { text: '⏳ รอตรวจสอบ', className: 'bg-amber-100 text-amber-700' },
  published: { text: '✅ เผยแพร่แล้ว', className: 'bg-emerald-100 text-emerald-700' },
  rejected: { text: '❌ ถูกปฏิเสธ', className: 'bg-red-100 text-red-600' },
  archived: { text: '📦 เก็บถาวร', className: 'bg-slate-100 text-slate-500' },
};

// รับ partnerId (ผูกมาจาก branches.partner_id ของ user ที่ login อยู่ — ดู
// packages/page.tsx) แทน organizationId เดิม เพราะตารางที่เขียนจริงตอนนี้
// คือ `packages` (public schema ที่เว็บสาธารณะอ่าน) ซึ่งผูกด้วย partner_id
// ไม่ใช่ `partner_packages` (ตารางเก่าที่ไม่เชื่อมกับเว็บสาธารณะเลย)
export function PackagesManager({ partnerId }: { partnerId: string }) {
  const supabase = createClient();
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<PackageFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function loadPackages() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('packages')
      .select('*')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false });

    setLoading(false);

    if (fetchError) {
      setError('โหลดข้อมูลไม่สำเร็จ: ' + fetchError.message);
      return;
    }

    setPackages(data as Package[]);
  }

  useEffect(() => {
    loadPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openModal(pkg?: Package) {
    setFormError(null);
    if (pkg) {
      setForm({
        id: pkg.id,
        title: pkg.title,
        description: pkg.description || '',
        original_price: String(pkg.original_price),
        special_price: pkg.special_price ? String(pkg.special_price) : '',
        is_promotion: pkg.is_promotion,
        duration: pkg.duration || '',
        image_url: pkg.image_url || '',
      });
    } else {
      setForm(emptyForm);
    }
    setModalOpen(true);
  }

  async function handleImageUpload(file: File) {
    setUploading(true);
    setFormError(null);
    try {
      const path = `packages/${partnerId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage
        .from('partner-images')
        .upload(path, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('partner-images').getPublicUrl(path);
      setForm((f) => ({ ...f, image_url: data.publicUrl }));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'อัปโหลดรูปไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.title.trim()) {
      setFormError('กรุณากรอกชื่อโปรแกรม');
      return;
    }
    if (!form.original_price || Number(form.original_price) <= 0) {
      setFormError('กรุณากรอกราคาที่ถูกต้อง');
      return;
    }

    setSaving(true);

    const payload = {
      partner_id: partnerId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      original_price: Number(form.original_price),
      special_price: form.special_price ? Number(form.special_price) : null,
      is_promotion: form.is_promotion,
      duration: form.duration.trim() || null,
      image_url: form.image_url.trim() || null,
    };

    let result;
    if (form.id) {
      // แก้ไขโปรแกรมเดิม — กลับไปเป็น 'pending' เสมอ เพราะแก้เนื้อหาแล้ว
      // ควรให้แอดมินตรวจสอบซ้ำก่อนขึ้นเว็บอีกครั้ง ไม่ auto-publish ทับของเดิม
      result = await supabase
        .from('packages')
        .update({ ...payload, status: 'pending' })
        .eq('id', form.id)
        .eq('partner_id', partnerId);
    } else {
      result = await supabase.from('packages').insert({ ...payload, status: 'pending' });
    }

    setSaving(false);

    if (result.error) {
      setFormError('บันทึกไม่สำเร็จ: ' + result.error.message);
      return;
    }

    setModalOpen(false);
    loadPackages();
  }

  async function handleDelete(id: string) {
    if (!confirm('ลบโปรแกรมนี้? การดำเนินการนี้ไม่สามารถกู้คืนได้')) return;

    const { error: deleteError } = await supabase
      .from('packages')
      .delete()
      .eq('id', id)
      .eq('partner_id', partnerId);

    if (deleteError) {
      alert('ลบไม่สำเร็จ: ' + deleteError.message);
      return;
    }

    loadPackages();
  }

  const publishedCount = packages.filter((p) => p.status === 'published').length;
  const pendingCount = packages.filter((p) => p.status === 'pending').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm text-slate-500">
          <span>ทั้งหมด {packages.length}</span>
          <span className="text-emerald-600">เผยแพร่แล้ว {publishedCount}</span>
          {pendingCount > 0 ? <span className="text-amber-600">รอตรวจสอบ {pendingCount}</span> : null}
        </div>
        <div className="flex gap-2">
          <button onClick={loadPackages} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            รีเฟรช
          </button>
          <button onClick={() => openModal()} className="btn-primary text-sm">
            + เพิ่มโปรแกรม
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
      ) : packages.length === 0 ? (
        <p className="text-sm text-slate-400">ยังไม่มีโปรแกรม กด &quot;+ เพิ่มโปรแกรม&quot; เพื่อเริ่มต้น</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">ชื่อโปรแกรม</th>
                <th className="px-4 py-2">ราคา</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => (
                <tr key={pkg.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{pkg.title}</div>
                    {pkg.duration && <div className="text-xs text-slate-400">⏱️ {pkg.duration}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {pkg.special_price ? (
                      <>
                        <span className="mr-1 text-xs text-slate-400 line-through">
                          {formatTHB(pkg.original_price)}
                        </span>
                        <span className="font-medium text-primary-dark">{formatTHB(pkg.special_price)}</span>
                        {pkg.is_promotion && <span className="ml-1">🔥</span>}
                      </>
                    ) : (
                      <span className="font-medium text-slate-800">{formatTHB(pkg.original_price)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_LABEL[pkg.status].className}`}>
                        {STATUS_LABEL[pkg.status].text}
                      </span>
                      {pkg.status === 'published' && !pkg.is_active ? (
                        <span
                          className="rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-500"
                          title="ทีมงาน WOS ปิดการแสดงผลชั่วคราว ติดต่อทีมงานหากต้องการเปิดกลับ"
                        >
                          🚫 ปิดการแสดงผลชั่วคราว
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openModal(pkg)} className="mr-3 text-xs text-primary-dark hover:underline">
                      แก้ไข
                    </button>
                    <button onClick={() => handleDelete(pkg.id)} className="text-xs text-red-500 hover:underline">
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
            className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6"
          >
            <h3 className="text-lg font-bold text-slate-900">
              {form.id ? 'แก้ไขโปรแกรม' : 'เพิ่มโปรแกรมใหม่'}
            </h3>

            {formError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="form-label">ชื่อโปรแกรม *</label>
                <input
                  className="form-input"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="เช่น ตรวจสุขภาพประจำปี"
                />
              </div>

              <div className="md:col-span-2">
                <label className="form-label">คำอธิบาย</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="รายละเอียดโปรแกรม..."
                />
              </div>

              <div>
                <label className="form-label">ระยะเวลา</label>
                <input
                  className="form-input"
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: e.target.value })}
                  placeholder="เช่น 2 ชั่วโมง, 1 วัน"
                />
              </div>

              <div>
                <label className="form-label">ราคาปกติ (บาท) *</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="form-input"
                  value={form.original_price}
                  onChange={(e) => setForm({ ...form, original_price: e.target.value })}
                  placeholder="0"
                />
              </div>

              <div>
                <label className="form-label">ราคาพิเศษ (บาท)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="form-input"
                  value={form.special_price}
                  onChange={(e) => setForm({ ...form, special_price: e.target.value })}
                  placeholder="เว้นว่างหากไม่มี"
                />
              </div>

              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={form.is_promotion}
                    onChange={(e) => setForm({ ...form, is_promotion: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-primary-dark focus:ring-primary"
                  />
                  🔥 เป็นโปรโมชันพิเศษ
                </label>
              </div>

              <div className="md:col-span-2">
                <label className="form-label">รูปภาพ</label>
                <input
                  type="file"
                  accept="image/*"
                  className="form-input"
                  onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                />
                {uploading && <p className="mt-1 text-xs text-slate-400">⏳ กำลังอัปโหลด...</p>}
                {form.image_url && (
                  <div className="mt-2 flex items-center gap-3">
                    <Image
                      src={form.image_url}
                      alt="preview"
                      width={64}
                      height={64}
                      className="h-16 w-16 rounded-lg object-cover"
                      unoptimized
                    />
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, image_url: '' })}
                      className="text-xs text-red-500 hover:underline"
                    >
                      ลบรูป
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
              📌 โปรแกรมนี้จะขึ้นสถานะ &quot;รอตรวจสอบ&quot; หลังบันทึก ทีมงาน WOS จะตรวจสอบก่อนเผยแพร่บนเว็บไซต์จริง
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
