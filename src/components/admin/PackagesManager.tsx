'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';
import type { Package, Partner } from '@/lib/data';
import { distinctProvinces, normalizeProvince } from '@/lib/province';

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
  suggested_hotel_name: string;
  suggested_hotel_price_note: string;
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
  suggested_hotel_name: '',
  suggested_hotel_price_note: '',
};

const STATUS_LABEL: Record<Package['status'], { text: string; className: string }> = {
  pending: { text: '⏳ รอตรวจสอบ', className: 'bg-amber-100 text-amber-700' },
  published: { text: '✅ เผยแพร่แล้ว', className: 'bg-emerald-100 text-emerald-700' },
  rejected: { text: '❌ ถูกปฏิเสธ', className: 'bg-red-100 text-red-600' },
  archived: { text: '📦 เก็บถาวร', className: 'bg-slate-100 text-slate-500' },
};

type StatusFilter = 'all' | Package['status'];

export function PackagesManager() {
  const supabase = createClient();
  const [packages, setPackages] = useState<Package[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'active' | 'hidden'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [partnerFilter, setPartnerFilter] = useState<string>('all');
  // Category filter narrows by partner.category (Hotel/Transport/Clinic/...).
  // Derived from `partners` (not hardcoded) so a new category added later
  // shows up automatically without a code change.
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  // Province filter — same "derived from real data, not hardcoded"
  // reasoning as categoryFilter above. Values are normalized (see
  // src/lib/province.ts) so "กรุงเทพฯ" and "กรุงเทพ" collapse into one
  // option instead of showing as two.
  const [provinceFilter, setProvinceFilter] = useState<string>('all');
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
        suggested_hotel_name: (pkg.suggested_hotel_name as string) ?? '',
        suggested_hotel_price_note: (pkg.suggested_hotel_price_note as string) ?? '',
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
    if (uploading) {
      setFormError('กรุณารอให้อัปโหลดรูปเสร็จก่อนแล้วค่อยกดบันทึก');
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
      suggested_hotel_name: form.suggested_hotel_name.trim() || null,
      suggested_hotel_price_note: form.suggested_hotel_price_note.trim() || null,
    };
    // แอดมินสร้าง/แก้เอง = published ทันที ไม่ต้องผ่านขั้นตอนอนุมัติ
    // (ต่างจากที่พาร์ทเนอร์ส่งมาจาก portal ซึ่งเข้ามาเป็น 'pending' เสมอ)
    const { error } = form.id
      ? await supabase.from('packages').update({ ...payload, status: 'published' }).eq('id', form.id)
      : await supabase.from('packages').insert({ ...payload, status: 'published' });
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

  async function handleApprove(id: string) {
    const { error } = await supabase.from('packages').update({ status: 'published' }).eq('id', id);
    if (error) {
      alert('อนุมัติไม่สำเร็จ: ' + error.message);
      return;
    }
    loadAll();
  }

  async function handleReject(id: string) {
    if (!confirm('ปฏิเสธโปรแกรมนี้? พาร์ทเนอร์จะเห็นสถานะ "ถูกปฏิเสธ" ใน portal')) return;
    const { error } = await supabase.from('packages').update({ status: 'rejected' }).eq('id', id);
    if (error) {
      alert('ดำเนินการไม่สำเร็จ: ' + error.message);
      return;
    }
    loadAll();
  }

  // เปิด/ปิดการแสดงผลบนหน้าเว็บ — แยกจากสถานะอนุมัติ (status) โดยสิ้นเชิง
  // ใช้ระงับแพ็กเกจที่อนุมัติแล้วชั่วคราว (เช่น พาร์ทเนอร์แจ้งของหมด/ปิดปรับปรุง)
  // โดยไม่ต้องปฏิเสธหรือเก็บถาวร กดเปิดกลับมาแสดงได้ทันทีทีหลัง
  async function handleToggleActive(pkg: Package) {
    const nextActive = !pkg.is_active;
    const { error } = await supabase.from('packages').update({ is_active: nextActive }).eq('id', pkg.id);
    if (error) {
      alert('ดำเนินการไม่สำเร็จ: ' + error.message);
      return;
    }
    loadAll();
  }

  // Distinct partner categories, derived from the loaded partners list
  // rather than hardcoded — a new category (added by inserting a partner
  // with that category) shows up here automatically.
  const categories = useMemo(
    () => Array.from(new Set(partners.map((p) => p.category).filter(Boolean))).sort(),
    [partners]
  );

  // Distinct provinces, normalized so alias spellings (e.g. "กรุงเทพฯ"
  // vs "กรุงเทพ") collapse into one option — see src/lib/province.ts.
  const provinces = useMemo(() => distinctProvinces(partners), [partners]);

  // partners the categoryFilter/provinceFilter narrow the partner dropdown
  // to — used so picking "Hotel" + "กรุงเทพฯ" first only shows matching
  // partners in the partner select, instead of every partner.
  const partnersInCategory = useMemo(
    () =>
      partners
        .filter((p) => (categoryFilter === 'all' ? true : p.category === categoryFilter))
        .filter((p) => (provinceFilter === 'all' ? true : normalizeProvince(p.province) === provinceFilter)),
    [partners, categoryFilter, provinceFilter]
  );

  // Status filter (existing) is applied first, then category, province,
  // name search, and partner filter narrow it further — all combine with AND.
  const filtered = packages
    .filter((p) => (statusFilter === 'all' ? true : p.status === statusFilter))
    .filter((p) => {
      if (categoryFilter === 'all') return true;
      const partner = partners.find((pt) => pt.id === p.partner_id);
      return partner?.category === categoryFilter;
    })
    .filter((p) => {
      if (provinceFilter === 'all') return true;
      const partner = partners.find((pt) => pt.id === p.partner_id);
      return normalizeProvince(partner?.province) === provinceFilter;
    })
    .filter((p) =>
      searchQuery.trim() ? (p.title as string)?.toLowerCase().includes(searchQuery.trim().toLowerCase()) : true
    )
    .filter((p) => (partnerFilter === 'all' ? true : p.partner_id === partnerFilter))
    .filter((p) =>
      visibilityFilter === 'all' ? true : visibilityFilter === 'active' ? p.is_active : !p.is_active
    );
  const pendingCount = packages.filter((p) => p.status === 'pending').length;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-slate-900">
            แพ็กเกจ ({filtered.length}
            {filtered.length !== packages.length ? ` / ${packages.length}` : ''})
          </h2>
          {pendingCount > 0 ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
              ⏳ รอตรวจสอบ {pendingCount} รายการ
            </span>
          ) : null}
        </div>
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

      {/* ===== Filter สถานะ ===== */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'pending', 'published', 'rejected', 'archived'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              statusFilter === s ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s === 'all' ? 'ทั้งหมด' : STATUS_LABEL[s].text}
          </button>
        ))}
      </div>

      {/* ===== Filter การแสดงผล ===== */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: 'all', label: 'ทั้งหมด' },
          { key: 'active', label: '✅ แสดงอยู่' },
          { key: 'hidden', label: '🚫 ปิดการแสดงผล' },
        ] as const).map((v) => (
          <button
            key={v.key}
            onClick={() => setVisibilityFilter(v.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              visibilityFilter === v.key ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* ===== ค้นหา + กรองประเภทพาร์ทเนอร์ + กรองพาร์ทเนอร์ ===== */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ค้นหาชื่อโปรแกรม..."
          className="form-input max-w-xs flex-1"
        />
        <select
          value={categoryFilter}
          onChange={(e) => {
            const nextCategory = e.target.value;
            setCategoryFilter(nextCategory);
            // If the currently-selected partner isn't in the newly chosen
            // category, reset partnerFilter — otherwise the list silently
            // stays empty (category + partner filters AND together) with
            // no visible reason why.
            if (nextCategory !== 'all') {
              const current = partners.find((p) => p.id === partnerFilter);
              if (current && current.category !== nextCategory) {
                setPartnerFilter('all');
              }
            }
          }}
          className="form-input w-auto"
        >
          <option value="all">ทุกประเภท</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={provinceFilter}
          onChange={(e) => {
            const nextProvince = e.target.value;
            setProvinceFilter(nextProvince);
            // Same reset reasoning as categoryFilter above — if the
            // selected partner isn't in the newly chosen province, drop
            // partnerFilter back to "all" instead of silently emptying
            // the list.
            if (nextProvince !== 'all') {
              const current = partners.find((p) => p.id === partnerFilter);
              if (current && normalizeProvince(current.province) !== nextProvince) {
                setPartnerFilter('all');
              }
            }
          }}
          className="form-input w-auto"
        >
          <option value="all">ทุกจังหวัด</option>
          {provinces.map((prov) => (
            <option key={prov} value={prov}>
              {prov}
            </option>
          ))}
        </select>
        <select
          value={partnerFilter}
          onChange={(e) => setPartnerFilter(e.target.value)}
          className="form-input w-auto"
        >
          <option value="all">ทุกพาร์ทเนอร์</option>
          {partnersInCategory.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {searchQuery || partnerFilter !== 'all' || categoryFilter !== 'all' || provinceFilter !== 'all' ? (
          <button
            onClick={() => {
              setSearchQuery('');
              setPartnerFilter('all');
              setCategoryFilter('all');
              setProvinceFilter('all');
            }}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500"
          >
            ล้างตัวกรอง
          </button>
        ) : null}
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
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400">ไม่พบแพ็กเกจที่ตรงกับการค้นหา/ตัวกรอง</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">ชื่อโปรแกรม</th>
                <th className="px-4 py-2">พาร์ทเนอร์</th>
                <th className="px-4 py-2">ราคา</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((pkg) => (
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
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_LABEL[pkg.status].className}`}>
                        {STATUS_LABEL[pkg.status].text}
                      </span>
                      {!pkg.is_active ? (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">
                          🚫 ปิดการแสดงผล
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {pkg.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => handleApprove(pkg.id)}
                          className="mr-3 text-emerald-600 hover:underline"
                        >
                          อนุมัติ
                        </button>
                        <button onClick={() => handleReject(pkg.id)} className="mr-3 text-red-500 hover:underline">
                          ปฏิเสธ
                        </button>
                      </>
                    ) : null}
                    {pkg.status === 'published' ? (
                      <button
                        onClick={() => handleToggleActive(pkg)}
                        className={`mr-3 hover:underline ${pkg.is_active ? 'text-amber-600' : 'text-emerald-600'}`}
                      >
                        {pkg.is_active ? 'ปิดการแสดงผล' : 'เปิดการแสดงผล'}
                      </button>
                    ) : null}
                    <button onClick={() => openModal(pkg)} className="mr-3 text-primary-dark hover:underline">
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
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <p className="mb-3 text-xs text-slate-400">
                🏨 ที่พักแนะนำ — ใช้แค่โชว์ให้ผู้ป่วยเห็นภาพราคาคร่าวๆตอนดูโปรแกรม
                ไม่ใช่ราคาผูกมัด ราคาจริงตอนจองจะยืนยันแยกเป็นรายการโรงแรมในคำสั่งจอง
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">ชื่อโรงแรมที่แนะนำ</label>
                  <input
                    className="form-input"
                    placeholder="เช่น Vientiane Riverside Hotel"
                    value={form.suggested_hotel_name}
                    onChange={(e) => setForm({ ...form, suggested_hotel_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">ช่วงราคาโดยประมาณ</label>
                  <input
                    className="form-input"
                    placeholder="เช่น 1,200–1,800 บาท/คืน"
                    value={form.suggested_hotel_price_note}
                    onChange={(e) => setForm({ ...form, suggested_hotel_price_note: e.target.value })}
                  />
                </div>
              </div>
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
                <Image
                  src={form.image_url}
                  alt=""
                  width={80}
                  height={80}
                  className="mt-2 h-20 w-20 rounded-lg object-cover"
                  unoptimized
                />
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
              <button
                type="submit"
                disabled={saving || uploading}
                className="btn-primary text-sm disabled:opacity-60"
              >
                {saving ? 'กำลังบันทึก...' : uploading ? 'กำลังอัปโหลดรูป...' : 'บันทึก'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
