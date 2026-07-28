'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';
import type { Package, Partner } from '@/lib/data';

interface PackageFormState {
  id: string | null;
  partner_id: string;
  title: string;
  description: string;
  image_url: string;
  original_price: string;
  special_price: string;
  duration: string;
  is_promotion: boolean;
}

const emptyForm: PackageFormState = {
  id: null,
  partner_id: '',
  title: '',
  description: '',
  image_url: '',
  original_price: '',
  special_price: '',
  duration: '',
  is_promotion: false,
};

export function PackagesManager() {
  const supabase = createClient();
  const [packages, setPackages] = useState<Package[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<PackageFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function loadAll() {
    setLoading(true);
    setListError(null);
    const [{ data: pkgData, error: pkgError }, { data: partnerData, error: partnerError }] = await Promise.all([
      supabase.from('packages').select('*, partners(name)').order('created_at', { ascending: false }),
      supabase.from('partners').select('*').order('name'),
    ]);
    setLoading(false);
    if (pkgError || partnerError) {
      setListError((pkgError ?? partnerError)?.message ?? 'โหลดข้อมูลไม่สำเร็จ');
      return;
    }
    setPackages((pkgData ?? []) as Package[]);
    setPartners((partnerData ?? []) as Partner[]);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openModal(pkg?: Package) {
    setFormError(null);
    if (pkg) {
      setForm({
        id: pkg.id,
        partner_id: pkg.partner_id,
        title: pkg.title as string,
        description: (pkg.description as string) ?? '',
        image_url: pkg.image_url ?? '',
        original_price: pkg.original_price != null ? String(pkg.original_price) : '',
        special_price: pkg.special_price != null ? String(pkg.special_price) : '',
        duration: (pkg.duration as string) ?? '',
        is_promotion: !!pkg.is_promotion,
      });
    } else {
      setForm({ ...emptyForm, partner_id: partners[0]?.id ?? '' });
    }
    setModalOpen(true);
  }

  async function handleImageUpload(file: File) {
    setUploading(true);
    setFormError(null);
    try {
      const path = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage.from('partner-images').upload(path, file);
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
    if (!form.partner_id) {
      setFormError('กรุณาเลือกพาร์ทเนอร์ (ต้องมีพาร์ทเนอร์อย่างน้อย 1 รายก่อน)');
      return;
    }
    if (!form.title.trim()) {
      setFormError('กรุณากรอกชื่อโปรแกรม');
      return;
    }
    setSaving(true);
    const payload = {
      partner_id: form.partner_id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      image_url: form.image_url.trim() || null,
      original_price: Number(form.original_price) || 0,
      special_price: form.special_price ? Number(form.special_price) : null,
      duration: form.duration.trim() || null,
      is_promotion: form.is_promotion,
    };
    const { error } = form.id
      ? await supabase.from('packages').update(payload).eq('id', form.id)
      : await supabase.from('packages').insert(payload);
    setSaving(false);
    if (error) {
      setFormError('บันทึกไม่สำเร็จ: ' + error.message);
      return;
    }
    setModalOpen(false);
    loadAll();
  }

  async function handleDelete(id: string) {
    if (!confirm('ลบโปรแกรมนี้?')) return;
    const { error } = await supabase.from('packages').delete().eq('id', id);
    if (error) {
      alert('ลบไม่สำเร็จ: ' + error.message);
      return;
    }
    loadAll();
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">แพ็กเกจ ({packages.length})</h2>
        <div className="flex gap-2">
          <button onClick={loadAll} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            รีเฟรช
          </button>
          <button
            onClick={() => openModal()}
            disabled={partners.length === 0}
            className="btn-primary text-sm disabled:opacity-60"
          >
            + เพิ่มแพ็กเกจ
          </button>
        </div>
      </div>

      {partners.length === 0 && !loading ? (
        <p className="text-sm text-amber-600">ต้องเพิ่มพาร์ทเนอร์อย่างน้อย 1 รายก่อนจึงจะสร้างแพ็กเกจได้</p>
      ) : null}

      {listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {listError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">กำลังโหลด...</p>
      ) : packages.length === 0 ? (
        <p className="text-sm text-slate-400">ยังไม่มีแพ็กเกจ</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">ชื่อโปรแกรม</th>
                <th className="px-4 py-2">พาร์ทเนอร์</th>
                <th className="px-4 py-2">ราคา</th>
                <th className="px-4 py-2">โปรโมชัน</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => (
                <tr key={pkg.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">{pkg.title as string}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {(pkg.partners as { name?: string } | undefined)?.name ?? '-'}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {pkg.special_price ? (
                      <>
                        <span className="mr-1 text-slate-300 line-through">
                          {formatTHB(pkg.original_price as number)}
                        </span>
                        {formatTHB(pkg.special_price as number)}
                      </>
                    ) : (
                      formatTHB(pkg.original_price as number)
                    )}
                  </td>
                  <td className="px-4 py-2">{pkg.is_promotion ? '🔥' : '-'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => openModal(pkg)} className="mr-3 text-primary hover:underline">
                      แก้ไข
                    </button>
                    <button onClick={() => handleDelete(pkg.id)} className="text-red-500 hover:underline">
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
            <h3 className="text-base font-bold text-slate-900">
              {form.id ? 'แก้ไขแพ็กเกจ' : 'เพิ่มแพ็กเกจ'}
            </h3>
            {formError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {formError}
              </div>
            ) : null}

            <div>
              <label className="form-label">พาร์ทเนอร์ *</label>
              <select
                className="form-input"
                value={form.partner_id}
                onChange={(e) => setForm({ ...form, partner_id: e.target.value })}
              >
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">ชื่อโปรแกรม *</label>
              <input
                className="form-input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label">คำอธิบาย</label>
              <textarea
                className="form-input"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">ราคาปกติ *</label>
                <input
                  type="number"
                  min={0}
                  className="form-input"
                  value={form.original_price}
                  onChange={(e) => setForm({ ...form, original_price: e.target.value })}
                />
              </div>
              <div>
                <label className="form-label">ราคาพิเศษ</label>
                <input
                  type="number"
                  min={0}
                  className="form-input"
                  value={form.special_price}
                  onChange={(e) => setForm({ ...form, special_price: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="form-label">ระยะเวลา (เช่น 2 ชั่วโมง, 1 วัน)</label>
              <input
                className="form-input"
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.is_promotion}
                onChange={(e) => setForm({ ...form, is_promotion: e.target.checked })}
              />
              🔥 เป็นโปรโมชันพิเศษ
            </label>
            <div>
              <label className="form-label">รูปโปรแกรม</label>
              <input
                type="file"
                accept="image/*"
                className="form-input"
                onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
              />
              {uploading ? <p className="mt-1 text-xs text-slate-400">กำลังอัปโหลด...</p> : null}
              {form.image_url ? (
                <img src={form.image_url} alt="" className="mt-2 h-20 w-20 rounded-lg object-cover" />
              ) : null}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm"
              >
                ยกเลิก
              </button>
              <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-60">
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
