'use client';

// src/components/admin/PromoBannersManager.tsx
//
// Admin editor for public.promo_banners (093_promo_banners.sql,
// phase 2 of the 3-phase rollout described in
// PromoBannerSlider.tsx's header). Non-devs add/reorder/retire
// homepage banner slides here instead of editing the table directly.
//
// Image upload follows PartnersManager.tsx's uploadPartnerImage()
// pattern exactly (signed upload URL from the server, since the
// promo-banners bucket has no client-writable RLS policy — see
// api/admin/promo-banners/upload-image/route.ts's header), just
// against the promo-banners bucket instead of partner-images and
// with no cover/logo `kind` distinction.
//
// Reorder uses plain up/down move buttons rather than drag-and-drop —
// no drag library is used anywhere else in this admin UI, and the
// list is expected to stay small (see 093's display_order comment),
// so buttons are simpler and keyboard-accessible for free.

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Loader2, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface PromoBannerRow {
  id: string;
  image_url: string;
  link_url: string | null;
  title: string;
  display_order: number;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB — same ceiling as the bucket's file_size_limit (093)

// Converts a datetime-local input value (no timezone, local time) to
// an ISO string for the API, and back. Empty string means "no
// scheduling bound" (nullable column).
function toIso(localValue: string): string | null {
  if (!localValue) return null;
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PromoBannersManager() {
  const supabase = useMemo(() => createClient('admin'), []);

  const [banners, setBanners] = useState<PromoBannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  async function load() {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/admin/promo-banners', { cache: 'no-store' });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'โหลดข้อมูลไม่สำเร็จ');
      setBanners(result.banners ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sorted = [...banners].sort((a, b) => a.display_order - b.display_order);

  // Same signed-upload-URL pattern as PartnersManager.tsx's
  // uploadPartnerImage() — see that file's comment for why a plain
  // client-side .storage.upload() can't be used here.
  async function uploadBannerImage(file: File): Promise<string> {
    const res = await fetch('/api/admin/promo-banners/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result?.error ?? 'ขอลิงก์อัปโหลดไม่สำเร็จ');
    const { error: uploadError } = await supabase.storage
      .from('promo-banners')
      .uploadToSignedUrl(result.path, result.token, file);
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('promo-banners').getPublicUrl(result.path);
    return data.publicUrl;
  }

  function extractBannerImagePath(publicUrl: string): string | null {
    const marker = '/object/public/promo-banners/';
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    try {
      return decodeURIComponent(publicUrl.slice(idx + marker.length));
    } catch {
      return null;
    }
  }

  async function deleteBannerImage(publicUrl: string) {
    const path = extractBannerImagePath(publicUrl);
    if (!path) return;
    await fetch('/api/admin/promo-banners/upload-image', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => {});
  }

  // Uploading a new file immediately creates a new (inactive-by-
  // default-off, actually active) slide row — there's no separate
  // "new slide" draft form; each row in the list already has
  // everything editable inline once it exists.
  async function handleNewFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setListError('ไฟล์รูปต้องไม่เกิน 5MB');
      return;
    }
    setUploading(true);
    setListError(null);
    try {
      const publicUrl = await uploadBannerImage(file);
      const res = await fetch('/api/admin/promo-banners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: publicUrl, title: file.name.replace(/\.[^.]+$/, '') }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'เพิ่มแบนเนอร์ไม่สำเร็จ');
      setBanners((prev) => [...prev, result.banner]);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  async function patchBanner(id: string, patch: Record<string, unknown>) {
    setSavingId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/admin/promo-banners/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'บันทึกไม่สำเร็จ');
      setBanners((prev) => prev.map((b) => (b.id === id ? result.banner : b)));
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  }

  async function removeBanner(banner: PromoBannerRow) {
    if (!confirm(`ลบแบนเนอร์ "${banner.title || banner.id}"?`)) return;
    setSavingId(banner.id);
    setListError(null);
    try {
      const res = await fetch(`/api/admin/promo-banners/${banner.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const result = await res.json().catch(() => null);
        throw new Error(result?.detail ?? result?.error ?? 'ลบไม่สำเร็จ');
      }
      await deleteBannerImage(banner.image_url);
      setBanners((prev) => prev.filter((b) => b.id !== banner.id));
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'ลบไม่สำเร็จ');
    } finally {
      setSavingId(null);
    }
  }

  // Swaps this row with its neighbor, then sends the whole list's new
  // display_order to /reorder in one call — matches 093's "renumber
  // the whole list on reorder" design (plain integer key, not
  // fractional/lexicographic).
  async function move(id: string, direction: -1 | 1) {
    const idx = sorted.findIndex((b) => b.id === id);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return;

    const next = [...sorted];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    const order = next.map((b, i) => ({ id: b.id, display_order: i }));

    setReordering(true);
    setListError(null);
    try {
      const res = await fetch('/api/admin/promo-banners/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'จัดเรียงไม่สำเร็จ');
      setBanners(result.banners ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'จัดเรียงไม่สำเร็จ');
    } finally {
      setReordering(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">แบนเนอร์โปรโมชั่นหน้าแรก</h2>
        <p className="mt-1 text-xs text-slate-400">
          สไลด์ใต้ Hero หน้าแรก (PromoBannerSlider.tsx) — รูปที่อัปโหลดควรมีข้อความ/CTA อยู่ในรูปแล้ว
          ช่อง &quot;ชื่อ&quot; ใช้เป็น alt text เท่านั้น ไม่ได้แสดงทับบนรูป ตั้งวันเริ่ม/สิ้นสุดได้ถ้าอยากให้หมดอายุเอง
          ไม่งั้นคุมด้วยสวิตช์ &quot;แสดงอยู่&quot; อย่างเดียวก็พอ
        </p>
        <p className="mt-2 text-xs text-slate-400">
          ขนาดรูปแนะนำ: <strong className="font-semibold text-slate-500">1600×470px</strong> (สัดส่วน
          ~3.4:1) — วางข้อความ/โลโก้สำคัญไว้กลางภาพและเว้นขอบซ้าย-ขวาให้พอ เพราะบนมือถือกรอบจะแคบลง
          (~2.2:1) และครอปขอบซ้าย-ขวาออกบางส่วน ไฟล์ JPG/PNG/WebP/GIF ไม่เกิน 5MB
        </p>
      </div>

      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 hover:border-primary hover:text-primary-dark">
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {uploading ? 'กำลังอัปโหลด...' : '+ เพิ่มแบนเนอร์ใหม่ (อัปโหลดรูป)'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleNewFile(file);
            e.target.value = '';
          }}
        />
      </label>

      {listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{listError}</div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">กำลังโหลด...</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-slate-400">ยังไม่มีแบนเนอร์ — อัปโหลดรูปด้านบนเพื่อเริ่มต้น</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((banner, i) => (
            <div key={banner.id} className="flex gap-4 rounded-xl border border-slate-100 p-3">
              <div className="flex flex-col items-center justify-center gap-1">
                <button
                  onClick={() => move(banner.id, -1)}
                  disabled={i === 0 || reordering}
                  className="rounded p-1 text-slate-400 hover:text-primary-dark disabled:opacity-30"
                  aria-label="เลื่อนขึ้น"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <span className="text-xs text-slate-300">{i + 1}</span>
                <button
                  onClick={() => move(banner.id, 1)}
                  disabled={i === sorted.length - 1 || reordering}
                  className="rounded p-1 text-slate-400 hover:text-primary-dark disabled:opacity-30"
                  aria-label="เลื่อนลง"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>

              <div className="relative h-20 w-36 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
                <Image src={banner.image_url} alt={banner.title || 'banner'} fill className="object-cover" />
              </div>

              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  className="form-input w-full text-sm"
                  placeholder="ชื่อ (alt text)"
                  defaultValue={banner.title}
                  onBlur={(e) => {
                    if (e.target.value !== banner.title) patchBanner(banner.id, { title: e.target.value });
                  }}
                />
                <input
                  type="url"
                  className="form-input w-full text-sm"
                  placeholder="ลิงก์เมื่อคลิก (ไม่บังคับ)"
                  defaultValue={banner.link_url ?? ''}
                  onBlur={(e) => {
                    if (e.target.value !== (banner.link_url ?? '')) {
                      patchBanner(banner.id, { link_url: e.target.value });
                    }
                  }}
                />
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <label className="flex items-center gap-1">
                    เริ่ม
                    <input
                      type="datetime-local"
                      className="form-input text-xs"
                      defaultValue={toLocalInput(banner.start_date)}
                      onBlur={(e) => patchBanner(banner.id, { start_date: toIso(e.target.value) })}
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    สิ้นสุด
                    <input
                      type="datetime-local"
                      className="form-input text-xs"
                      defaultValue={toLocalInput(banner.end_date)}
                      onBlur={(e) => patchBanner(banner.id, { end_date: toIso(e.target.value) })}
                    />
                  </label>
                </div>
              </div>

              <div className="flex flex-col items-end justify-between gap-2">
                <button
                  onClick={() => patchBanner(banner.id, { is_active: !banner.is_active })}
                  disabled={savingId === banner.id}
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    banner.is_active ? 'bg-primary-light text-primary-dark' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {banner.is_active ? 'แสดงอยู่' : 'ปิดการแสดงผล'}
                </button>
                <button
                  onClick={() => removeBanner(banner)}
                  disabled={savingId === banner.id}
                  className="rounded p-1 text-slate-400 hover:text-red-600"
                  aria-label="ลบ"
                >
                  {savingId === banner.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
