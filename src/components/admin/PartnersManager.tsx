'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import type { Partner } from '@/lib/data';

// DB category options, flattened the same way populateCategorySelect() did
// in the old admin-partners.html (hotel_transport card covers 2 DB values).
const CATEGORY_OPTIONS = [
  { value: 'Hospital', label: 'โรงพยาบาล' },
  { value: 'Clinic', label: 'คลินิก & ความงาม' },
  { value: 'Dental', label: 'ทันตกรรม' },
  { value: 'Wellness', label: 'เวลเนส & แพทย์ทางเลือก' },
  { value: 'Spa', label: 'สปา & ผ่อนคลาย' },
  { value: 'Hotel', label: 'โรงแรม & รถรับส่ง — Hotel' },
  { value: 'Transport', label: 'โรงแรม & รถรับส่ง — Transport' },
];

interface PartnerFormState {
  id: string | null;
  name: string;
  category: string;
  province: string;
  rating: string;
  status: 'active' | 'inactive';
  description: string;
  cover_image_url: string;
  logo_url: string;
  show_on_homepage: boolean;
}

const emptyForm: PartnerFormState = {
  id: null,
  name: '',
  category: CATEGORY_OPTIONS[0].value,
  province: '',
  rating: '',
  status: 'active',
  description: '',
  cover_image_url: '',
  logo_url: '',
  show_on_homepage: false,
};

export function PartnersManager() {
  const supabase = createClient();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<PartnerFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function loadPartners() {
    setLoading(true);
    setListError(null);
    const { data, error } = await supabase.from('partners').select('*').order('name');
    setLoading(false);
    if (error) {
      setListError(error.message);
      return;
    }
    setPartners((data ?? []) as Partner[]);
  }

  useEffect(() => {
    loadPartners();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openModal(partner?: Partner) {
    setFormError(null);
    if (partner) {
      setForm({
        id: partner.id,
        name: partner.name ?? '',
        category: partner.category ?? CATEGORY_OPTIONS[0].value,
        province: (partner.province as string) ?? '',
        rating: partner.rating != null ? String(partner.rating) : '',
        status: partner.status,
        description: (partner.description as string) ?? '',
        cover_image_url: partner.cover_image_url ?? '',
        logo_url: (partner as { logo_url?: string }).logo_url ?? '',
        show_on_homepage: !!(partner as { show_on_homepage?: boolean }).show_on_homepage,
      });
    } else {
      setForm(emptyForm);
    }
    setModalOpen(true);
  }

  async function handleCoverUpload(file: File) {
    setUploading(true);
    setFormError(null);
    try {
      const path = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage.from('partner-images').upload(path, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('partner-images').getPublicUrl(path);
      setForm((f) => ({ ...f, cover_image_url: data.publicUrl }));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'อัปโหลดรูปไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  // Same bucket as the cover photo (`partner-images`), just a
  // `logos/` prefix to keep the two kinds of image apart in storage.
  // See migration 023 for why logo_url is a separate column from
  // cover_image_url.
  async function handleLogoUpload(file: File) {
    setUploading(true);
    setFormError(null);
    try {
      const path = `logos/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage.from('partner-images').upload(path, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('partner-images').getPublicUrl(path);
      setForm((f) => ({ ...f, logo_url: data.publicUrl }));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'อัปโหลดโลโก้ไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('กรุณากรอกชื่อพาร์ทเนอร์');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      category: form.category,
      province: form.province.trim() || null,
      rating: form.rating ? Number(form.rating) : null,
      status: form.status,
      description: form.description.trim() || null,
      cover_image_url: form.cover_image_url.trim() || null,
      logo_url: form.logo_url.trim() || null,
      show_on_homepage: form.show_on_homepage,
    };
    const { error } = form.id
      ? await supabase.from('partners').update(payload).eq('id', form.id)
      : await supabase.from('partners').insert(payload);
    setSaving(false);
    if (error) {
      setFormError('บันทึกไม่สำเร็จ: ' + error.message);
      return;
    }
    setModalOpen(false);
    loadPartners();
  }

  async function handleDelete(id: string) {
    if (!confirm('ลบพาร์ทเนอร์นี้? แพ็กเกจที่ผูกอยู่จะได้รับผลกระทบ')) return;
    const { error } = await supabase.from('partners').delete().eq('id', id);
    if (error) {
      alert('ลบไม่สำเร็จ: ' + error.message);
      return;
    }
    loadPartners();
  }

  // Name search is case-insensitive and matches anywhere in the name
  // (not just prefix) — same UX as PartnersSearchGrid.tsx on the
  // customer-facing directory. Category filter is exact-match against
  // CATEGORY_OPTIONS values.
  const filteredPartners = partners.filter((p) => {
    const matchesSearch = searchQuery.trim()
      ? p.name?.toLowerCase().includes(searchQuery.trim().toLowerCase())
      : true;
    const matchesCategory = categoryFilter === 'all' ? true : p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">
          พาร์ทเนอร์ ({filteredPartners.length}
          {filteredPartners.length !== partners.length ? ` / ${partners.length}` : ''})
        </h2>
        <div className="flex gap-2">
          <button onClick={loadPartners} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            รีเฟรช
          </button>
          <button onClick={() => openModal()} className="btn-primary text-sm">
            + เพิ่มพาร์ทเนอร์
          </button>
        </div>
      </div>

      {/* ===== ค้นหา + กรองหมวดหมู่ ===== */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ค้นหาชื่อพาร์ทเนอร์..."
          className="form-input max-w-xs flex-1"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="form-input w-auto"
        >
          <option value="all">ทุกหมวดหมู่</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {searchQuery || categoryFilter !== 'all' ? (
          <button
            onClick={() => {
              setSearchQuery('');
              setCategoryFilter('all');
            }}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500"
          >
            ล้างตัวกรอง
          </button>
        ) : null}
      </div>

      {listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {listError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">กำลังโหลด...</p>
      ) : partners.length === 0 ? (
        <p className="text-sm text-slate-400">ยังไม่มีพาร์ทเนอร์</p>
      ) : filteredPartners.length === 0 ? (
        <p className="text-sm text-slate-400">ไม่พบพาร์ทเนอร์ที่ตรงกับการค้นหา/ตัวกรอง</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">ชื่อ</th>
                <th className="px-4 py-2">หมวดหมู่</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2">คะแนน</th>
                <th className="px-4 py-2">หน้าแรก</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredPartners.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">{p.name}</td>
                  <td className="px-4 py-2 text-slate-500">{p.category}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        p.status === 'active' ? 'bg-primary-light text-primary' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{p.rating ?? '-'}</td>
                  <td className="px-4 py-2">
                    {(p as { show_on_homepage?: boolean }).show_on_homepage ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">✅ โชว์</span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => openModal(p)} className="mr-3 text-primary hover:underline">
                      แก้ไข
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:underline">
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
              {form.id ? 'แก้ไขพาร์ทเนอร์' : 'เพิ่มพาร์ทเนอร์'}
            </h3>
            {formError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {formError}
              </div>
            ) : null}

            <div>
              <label className="form-label">ชื่อพาร์ทเนอร์ *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">หมวดหมู่</label>
                <select
                  className="form-input"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">สถานะ</label>
                <select
                  className="form-input"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">จังหวัด</label>
                <input
                  className="form-input"
                  value={form.province}
                  onChange={(e) => setForm({ ...form, province: e.target.value })}
                />
              </div>
              <div>
                <label className="form-label">คะแนน (0-5)</label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={5}
                  className="form-input"
                  value={form.rating}
                  onChange={(e) => setForm({ ...form, rating: e.target.value })}
                />
              </div>
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
            <div>
              <label className="form-label">รูปปก</label>
              <input
                type="file"
                accept="image/*"
                className="form-input"
                onChange={(e) => e.target.files?.[0] && handleCoverUpload(e.target.files[0])}
              />
              {uploading ? <p className="mt-1 text-xs text-slate-400">กำลังอัปโหลด...</p> : null}
              {form.cover_image_url ? (
                <Image
                  src={form.cover_image_url}
                  alt=""
                  width={80}
                  height={80}
                  className="mt-2 h-20 w-20 rounded-lg object-cover"
                  unoptimized
                />
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <label className="form-label">โลโก้ (สำหรับแถบเลื่อนหน้าแรก)</label>
              <p className="mb-2 text-xs text-slate-400">
                ใช้ไฟล์ PNG/SVG พื้นหลังโปร่งใส แนะนำขนาด 400×160px (หรือสัดส่วนใกล้เคียง) จะเลื่อนได้สวยที่สุด — ดูรายละเอียดขนาดเพิ่มเติมได้ที่ PartnerLogos.tsx
              </p>
              <input
                type="file"
                accept="image/png,image/svg+xml,image/webp"
                className="form-input"
                onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}
              />
              {uploading ? <p className="mt-1 text-xs text-slate-400">กำลังอัปโหลด...</p> : null}
              {form.logo_url ? (
                <div className="mt-2 flex h-16 items-center rounded-lg border border-slate-200 bg-white px-3">
                  <Image
                    src={form.logo_url}
                    alt=""
                    width={160}
                    height={64}
                    className="max-h-12 w-auto object-contain"
                    unoptimized
                  />
                </div>
              ) : null}
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.show_on_homepage}
                  onChange={(e) => setForm({ ...form, show_on_homepage: e.target.checked })}
                />
                แสดงในแถบ &quot;ได้รับความไว้วางใจจากพันธมิตรชั้นนำ&quot; หน้าแรก
              </label>
              {form.show_on_homepage && !form.logo_url ? (
                <p className="mt-1 text-xs text-amber-600">⚠️ ต้องอัปโหลดโลโก้ก่อน ไม่งั้นจะไม่แสดงในหน้าแรก</p>
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
