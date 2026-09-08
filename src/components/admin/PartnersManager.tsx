'use client';

import { useEffect, useMemo, useState } from 'react';
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

// Response shape of GET /api/admin/partners/[id]/hard-delete (precheck) —
// see that route's file header. canDelete is server-computed (order_items
// / packages / reviews = 0); the confirm button below trusts it, but the
// DELETE call is re-checked server-side regardless (RLS/RPC don't trust
// this either — see sql/075_admin_hard_delete_partner.sql).
type HardDeletePrecheck = {
  partner: { id: string; name: string; category: string; status: string };
  canDelete: boolean;
  blockingReason: string | null;
  willDelete: {
    organizations: number;
    branches: number;
    portalUsers: number;
    depositRules: number;
    settlements: number;
    packages: number;
    reviews: number;
  };
  warnings: {
    patients: number;
    documents: number;
    subscriptions: number;
  };
};

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
  // Medical Logistics Map (migration 045) — google_maps_url is the raw
  // input the admin pastes; latitude/longitude/location_status/
  // location_source/location_resolved_at/location_verified_at are all
  // set server-side by the resolve-location API or the verify/reject
  // actions below, never typed in directly.
  address: string;
  google_maps_url: string;
  latitude: number | null;
  longitude: number | null;
  location_status: 'pending' | 'verified' | 'rejected';
  location_source: string | null;
  location_resolved_at: string | null;
  location_verified_at: string | null;
  line_user_id: string;
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
  address: '',
  google_maps_url: '',
  latitude: null,
  longitude: null,
  location_status: 'pending',
  location_source: null,
  location_resolved_at: null,
  location_verified_at: null,
  line_user_id: '',
};

export function PartnersManager() {
  // Must read the same session cookie AdminGate signs in under ('sb-wos-admin')
  // — createClient() with no namespace reads a different, unauthenticated
  // cookie, so is_platform_admin() sees no session and every INSERT/UPDATE
  // here fails RLS ("new row violates row-level security policy") even
  // though SELECT still works (partners has a public read policy too).
  const supabase = useMemo(() => createClient('admin'), []);
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
  const [resolvingLocation, setResolvingLocation] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [updatingLocationStatus, setUpdatingLocationStatus] = useState(false);

  // Portal login (แบบที่ 2: สร้างบัญชีไว้ล็อกอินได้ในอนาคต แต่ไม่ส่งอีเมล —
  // แอดมินคัดลอกลิงก์ไปส่งเอง) — ดู /api/admin/partners/[id]/portal-access
  const [portalForm, setPortalForm] = useState({
    organizationName: '',
    branchName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
  });
  const [portalCreating, setPortalCreating] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [portalInviteLink, setPortalInviteLink] = useState<string | null>(null);
  const [portalExistingEmail, setPortalExistingEmail] = useState<string | null>(null);

  // "ดูแทนพาร์ทเนอร์" (impersonate) — ดู /api/admin/partners/[id]/impersonate
  // route ฝั่ง backend มีครบแล้ว (audit log ครบ) แต่ไม่เคยมีปุ่มเรียกใช้จริง
  // เพิ่มตรงนี้: กดแล้วเปิดแท็บใหม่ที่ล็อกอินเป็นพาร์ทเนอร์นั้นทันที
  const [impersonating, setImpersonating] = useState(false);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);

  // ลบพาร์ทเนอร์ถาวร (hard delete) — ดู /api/admin/partners/[id]/hard-delete
  // GET = precheck (นับว่ามีอะไรผูกอยู่บ้าง, ลบได้ไหม), DELETE = ลบจริง
  // ปุ่มนี้ไม่เคยมี UI มาก่อน แม้ backend จะพร้อมแล้ว (075/route.ts)
  // ความปลอดภัยอยู่ 3 ชั้น: (1) เรียก precheck ก่อนเสมอ และ disable ปุ่มยืนยัน
  // ถ้า canDelete เป็น false, (2) ต้องพิมพ์ชื่อพาร์ทเนอร์ให้ตรงเป๊ะก่อนถึงจะกดลบได้
  // (กันการกดพลาด/กดรัว ๆ แบบ confirm() เดิม), (3) เซิร์ฟเวอร์/RPC re-check
  // เงื่อนไขเดิมซ้ำอีกรอบอยู่ดี ต่อให้ precheck ฝั่งนี้เพี้ยนหรือถูก bypass
  const [deleteTarget, setDeleteTarget] = useState<Partner | null>(null);
  const [deletePrecheck, setDeletePrecheck] = useState<HardDeletePrecheck | null>(null);
  const [deletePrecheckLoading, setDeletePrecheckLoading] = useState(false);
  const [deletePrecheckError, setDeletePrecheckError] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    setResolveError(null);
    setPortalError(null);
    setPortalInviteLink(null);
    setPortalExistingEmail(null);
    setImpersonateError(null);
    setPortalForm({
      organizationName: partner?.name ?? '',
      branchName: partner?.name ? `${partner.name} - สาขาหลัก` : '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
    });
    if (partner) {
      const p = partner as Partner & {
        address?: string | null;
        google_maps_url?: string | null;
        latitude?: number | null;
        longitude?: number | null;
        location_status?: 'pending' | 'verified' | 'rejected';
        location_source?: string | null;
        location_resolved_at?: string | null;
        location_verified_at?: string | null;
      };
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
        address: p.address ?? '',
        google_maps_url: p.google_maps_url ?? '',
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        location_status: p.location_status ?? 'pending',
        location_source: p.location_source ?? null,
        location_resolved_at: p.location_resolved_at ?? null,
        location_verified_at: p.location_verified_at ?? null,
        line_user_id: (p as { line_user_id?: string | null }).line_user_id ?? '',
      });
    } else {
      setForm({ ...emptyForm });
    }
    setModalOpen(true);
  }

  // 5 MB cap — same limit for cover and logo. Prevents an accidental
  // (or malicious) huge upload from eating storage quota; Supabase
  // Storage would accept much larger files without this check.
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

  // Admin uploads can never go through a plain client-side
  // `supabase.storage.from('partner-images').upload()` — the bucket's
  // insert policy (003_storage_bucket_partner_images.sql) requires the
  // caller's own `organization_id`, and admins don't have one (nor
  // does a brand-new partner that hasn't been saved yet). Instead: ask
  // /api/admin/partners/upload-image for a signed upload URL (minted
  // server-side with the service-role client, bypassing that policy
  // entirely for a real, auth-checked admin), then PUT the file
  // straight to Storage with it. Same shape as
  // uploadBookingAttachment() in src/lib/booking/upload-attachment.ts.
  async function uploadPartnerImage(file: File, kind: 'cover' | 'logo'): Promise<string> {
    const res = await fetch('/api/admin/partners/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, kind }),
    });
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result?.error ?? 'ขอลิงก์อัปโหลดไม่สำเร็จ');
    }
    const { error: uploadError } = await supabase.storage
      .from('partner-images')
      .uploadToSignedUrl(result.path, result.token, file);
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('partner-images').getPublicUrl(result.path);
    return data.publicUrl;
  }

  // Extracts the storage object path back out of a getPublicUrl()
  // result, so the "remove image" button can tell the delete route
  // which object to remove without re-deriving the path some other
  // way. Returns null for anything not shaped like a partner-images
  // public URL (e.g. a legacy hand-pasted URL from before uploads
  // existed) — those just get cleared from the form, nothing to
  // delete from storage.
  function extractPartnerImagePath(publicUrl: string): string | null {
    const marker = '/object/public/partner-images/';
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    try {
      return decodeURIComponent(publicUrl.slice(idx + marker.length));
    } catch {
      return null;
    }
  }

  async function deletePartnerImage(publicUrl: string) {
    const path = extractPartnerImagePath(publicUrl);
    if (!path) return; // nothing storage-side to clean up
    const res = await fetch('/api/admin/partners/upload-image', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      throw new Error(result?.error ?? 'ลบรูปไม่สำเร็จ');
    }
  }

  async function handleCoverUpload(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setFormError('ไฟล์รูปปกต้องไม่เกิน 5MB');
      return;
    }
    setUploading(true);
    setFormError(null);
    try {
      const publicUrl = await uploadPartnerImage(file, 'cover');
      setForm((f) => ({ ...f, cover_image_url: publicUrl }));
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
    if (file.size > MAX_UPLOAD_BYTES) {
      setFormError('ไฟล์โลโก้ต้องไม่เกิน 5MB');
      return;
    }
    setUploading(true);
    setFormError(null);
    try {
      const publicUrl = await uploadPartnerImage(file, 'logo');
      setForm((f) => ({ ...f, logo_url: publicUrl }));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'อัปโหลดโลโก้ไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveCoverImage() {
    if (!form.cover_image_url) return;
    setUploading(true);
    setFormError(null);
    try {
      await deletePartnerImage(form.cover_image_url);
      setForm((f) => ({ ...f, cover_image_url: '' }));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'ลบรูปไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveLogoImage() {
    if (!form.logo_url) return;
    setUploading(true);
    setFormError(null);
    try {
      await deletePartnerImage(form.logo_url);
      setForm((f) => ({ ...f, logo_url: '' }));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'ลบโลโก้ไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  // Calls the SSRF-safe server route (never fetches the Google Maps URL
  // from the browser) which resolves it, extracts lat/lng, and writes
  // them straight to the partner row. Requires the partner to already
  // exist — resolve-location updates by id, so a brand-new partner
  // must be saved once first.
  async function handleResolveLocation() {
    if (!form.id) {
      setResolveError('บันทึกพาร์ทเนอร์ก่อน แล้วค่อย resolve ตำแหน่งได้');
      return;
    }
    if (!form.google_maps_url.trim()) {
      setResolveError('กรุณาวางลิงก์ Google Maps ก่อน');
      return;
    }
    setResolvingLocation(true);
    setResolveError(null);
    try {
      const res = await fetch(`/api/admin/partners/${form.id}/resolve-location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_maps_url: form.google_maps_url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResolveError(data.error ?? 'resolve ไม่สำเร็จ');
        return;
      }
      setForm((f) => ({
        ...f,
        latitude: data.partner.latitude,
        longitude: data.partner.longitude,
        location_status: data.partner.location_status,
        location_source: data.partner.location_source,
        location_resolved_at: data.partner.location_resolved_at,
      }));
      loadPartners();
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : 'resolve ไม่สำเร็จ');
    } finally {
      setResolvingLocation(false);
    }
  }

  // Verify/reject go through the admin API (not the RLS-protected
  // browser client) so they're recorded in audit_log (073) — this
  // gates public visibility on the map (047 nearby_partners()), so
  // who verified what and when needs to be recoverable.
  async function handleSetLocationStatus(nextStatus: 'verified' | 'rejected') {
    if (!form.id) return;
    setUpdatingLocationStatus(true);
    setResolveError(null);
    try {
      const res = await fetch(`/api/admin/partners/${form.id}/verify-location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResolveError(data.error ?? 'อัปเดตสถานะไม่สำเร็จ');
        return;
      }
      setForm((f) => ({
        ...f,
        location_status: data.partner.location_status,
        location_verified_at: data.partner.location_verified_at,
      }));
      loadPartners();
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : 'อัปเดตสถานะไม่สำเร็จ');
    } finally {
      setUpdatingLocationStatus(false);
    }
  }

  // Creates org+branch+Auth user for this partner and returns a
  // copyable set-password link — no email is ever sent (see the route's
  // header comment for how generateLink({type:'invite'}) does that).
  async function handleCreatePortalAccess() {
    if (!form.id) return;
    setPortalError(null);
    setPortalExistingEmail(null);
    if (!portalForm.organizationName.trim() || !portalForm.branchName.trim()) {
      setPortalError('กรุณากรอกชื่อองค์กรและชื่อสาขา');
      return;
    }
    if (!portalForm.contactName.trim()) {
      setPortalError('กรุณากรอกชื่อผู้ติดต่อ');
      return;
    }
    if (!portalForm.contactEmail.trim() || !portalForm.contactEmail.includes('@')) {
      setPortalError('กรุณากรอกอีเมลผู้ติดต่อที่ถูกต้อง');
      return;
    }
    setPortalCreating(true);
    try {
      const res = await fetch(`/api/admin/partners/${form.id}/portal-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationName: portalForm.organizationName.trim(),
          branchName: portalForm.branchName.trim(),
          contactName: portalForm.contactName.trim(),
          contactEmail: portalForm.contactEmail.trim(),
          contactPhone: portalForm.contactPhone.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPortalError(data.error ?? 'สร้างบัญชีเข้าสู่ระบบไม่สำเร็จ');
        if (data.existingBranchEmail) setPortalExistingEmail(data.existingBranchEmail);
        return;
      }
      setPortalInviteLink(data.inviteLink);
    } catch (e) {
      setPortalError(e instanceof Error ? e.message : 'สร้างบัญชีเข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setPortalCreating(false);
    }
  }

  // For a partner that already has a login (existingBranchEmail came
  // back from handleCreatePortalAccess above) — re-mints a fresh
  // link for that same email via the existing resend-invite-link route
  // instead of trying to create a second org/branch.
  async function handleResendPortalLink(email: string) {
    setPortalError(null);
    setPortalCreating(true);
    try {
      const res = await fetch('/api/admin/partners/resend-invite-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPortalError(data.error ?? 'ขอลิงก์ใหม่ไม่สำเร็จ');
        return;
      }
      setPortalInviteLink(data.inviteLink);
      setPortalExistingEmail(null);
    } catch (e) {
      setPortalError(e instanceof Error ? e.message : 'ขอลิงก์ใหม่ไม่สำเร็จ');
    } finally {
      setPortalCreating(false);
    }
  }

  // เปิดแท็บใหม่ล่วงหน้าก่อน await เพื่อกัน popup blocker (browser จะบล็อก
  // window.open ที่เรียกหลัง await เพราะไม่ถือเป็น user gesture อีกต่อไป)
  // แล้วค่อยตั้ง .location ของแท็บนั้นหลังได้ actionLink กลับมา
  async function handleImpersonate() {
    if (!form.id) return;
    setImpersonateError(null);
    setImpersonating(true);
    const newTab = window.open('about:blank', '_blank');
    try {
      const res = await fetch(`/api/admin/partners/${form.id}/impersonate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        newTab?.close();
        setImpersonateError(data.error ?? 'เข้าดูแทนไม่สำเร็จ');
        return;
      }
      if (newTab) {
        newTab.location.href = data.actionLink;
      } else {
        // popup ถูกบล็อกไปแล้ว (เช่น browser ไม่นับเป็น user gesture) —
        // เปิดในแท็บปัจจุบันแทน ดีกว่าไม่ทำอะไรเลย
        window.location.href = data.actionLink;
      }
    } catch (e) {
      newTab?.close();
      setImpersonateError(e instanceof Error ? e.message : 'เข้าดูแทนไม่สำเร็จ');
    } finally {
      setImpersonating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('กรุณากรอกชื่อพาร์ทเนอร์');
      return;
    }
    if (form.show_on_homepage && !form.logo_url.trim()) {
      setFormError('ต้องอัปโหลดโลโก้ก่อน ถึงจะแสดงในหน้าแรกได้');
      return;
    }
    if (form.line_user_id.trim() && !/^U[0-9a-f]{32}$/i.test(form.line_user_id.trim())) {
      setFormError('LINE User ID ต้องขึ้นต้นด้วย U ตามด้วยตัวอักษร/ตัวเลข 32 ตัว (ไม่ใช่ LINE OA ID หรือชื่อที่แสดง)');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      category: form.category,
      province: form.province.trim() || null,
      // rating: ตัดออก — ห้ามพิมพ์มือแล้ว จะคำนวณจาก reviews จริงเท่านั้น เมื่อระบบพร้อม
      status: form.status,
      description: form.description.trim() || null,
      cover_image_url: form.cover_image_url.trim() || null,
      logo_url: form.logo_url.trim() || null,
      show_on_homepage: form.show_on_homepage,
      address: form.address.trim() || null,
      // google_maps_url was missing here — meant a saved partner's map
      // link silently reverted to blank on the next edit, even though
      // resolve-location (which writes it directly) worked fine.
      google_maps_url: form.google_maps_url.trim() || null,
      line_user_id: form.line_user_id.trim() || null,
    };
    const { error } = form.id
      ? await supabase.from('partners').update(payload).eq('id', form.id)
      : await supabase.from('partners').insert(payload);
    setSaving(false);
    if (error) {
      // idx_partners_line_user_id_unique (migration 086) — surface a
      // clear message instead of the raw Postgres constraint text.
      const dupeLineId = error.code === '23505' && error.message.includes('line_user_id');
      setFormError(dupeLineId ? 'LINE ID นี้ถูกผูกกับพาร์ทเนอร์รายอื่นอยู่แล้ว' : 'บันทึกไม่สำเร็จ: ' + error.message);
      return;
    }
    setModalOpen(false);
    loadPartners();
  }

    async function handleSuspend(id: string) {
    if (!confirm('ระงับพาร์ทเนอร์นี้?')) return;

    const res = await fetch(`/api/admin/partners/${id}/suspend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'inactive',
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'ระงับพาร์ทเนอร์ไม่สำเร็จ');
      return;
    }

    loadPartners();
  }

  async function handleReactivate(id: string) {
    if (!confirm('ต้องการเปิดใช้งานพาร์ทเนอร์นี้อีกครั้งหรือไม่?')) return;

    const res = await fetch(`/api/admin/partners/${id}/suspend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'active',
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'เปิดใช้งานพาร์ทเนอร์ไม่สำเร็จ');
      return;
    }

    loadPartners();
  }

  async function openDeleteModal(partner: Partner) {
    setDeleteTarget(partner);
    setDeletePrecheck(null);
    setDeletePrecheckError(null);
    setDeleteConfirmText('');
    setDeleteError(null);
    setDeletePrecheckLoading(true);
    try {
      const res = await fetch(`/api/admin/partners/${partner.id}/hard-delete`);
      const data = await res.json();
      if (!res.ok) {
        setDeletePrecheckError(data.error ?? 'ตรวจสอบข้อมูลไม่สำเร็จ');
        return;
      }
      setDeletePrecheck(data as HardDeletePrecheck);
    } catch (e) {
      setDeletePrecheckError(e instanceof Error ? e.message : 'ตรวจสอบข้อมูลไม่สำเร็จ');
    } finally {
      setDeletePrecheckLoading(false);
    }
  }

  function closeDeleteModal() {
    if (deleting) return; // อย่าให้ปิดโมดัลกลางอากาศระหว่างเรียก DELETE อยู่
    setDeleteTarget(null);
    setDeletePrecheck(null);
    setDeletePrecheckError(null);
    setDeleteConfirmText('');
    setDeleteError(null);
  }

  async function handleConfirmHardDelete() {
    if (!deleteTarget || !deletePrecheck?.canDelete) return;
    if (deleteConfirmText.trim() !== deleteTarget.name) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/partners/${deleteTarget.id}/hard-delete`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error ?? 'ลบไม่สำเร็จ');
        return;
      }
      setDeleteTarget(null);
      setDeletePrecheck(null);
      setDeleteConfirmText('');
      loadPartners();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'ลบไม่สำเร็จ');
    } finally {
      setDeleting(false);
    }
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
                <th className="px-4 py-2">ตำแหน่ง</th>
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
                        p.status === 'active' ? 'bg-primary-light text-primary-dark' : 'bg-slate-100 text-slate-400'
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
                  <td className="px-4 py-2">
                    {(() => {
                      const locStatus = (p as { location_status?: string }).location_status;
                      const latitude = (p as { latitude?: number | null }).latitude;
                      if (!locStatus || latitude == null) {
                        return <span className="text-xs text-slate-300">—</span>;
                      }
                      const badgeClass =
                        locStatus === 'verified'
                          ? 'bg-emerald-100 text-emerald-700'
                          : locStatus === 'rejected'
                            ? 'bg-red-100 text-red-600'
                            : 'bg-amber-100 text-amber-700';
                      return (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${badgeClass}`}>{locStatus}</span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => openModal(p)} className="mr-3 text-primary-dark hover:underline">
                      แก้ไข
                    </button>
                    {p.status === 'active' ? (
                      <button
                        onClick={() => handleSuspend(p.id)}
                        className="mr-3 text-red-500 hover:underline"
                      >
                        ระงับ
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReactivate(p.id)}
                        className="mr-3 text-emerald-600 hover:underline"
                      >
                        เปิดใช้งาน
                      </button>
                    )}
                    <button
                      onClick={() => openDeleteModal(p)}
                      className="text-red-700 hover:underline"
                      title="ลบถาวร — ย้อนกลับไม่ได้"
                    >
                      ลบถาวร
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
                <label className="form-label">คะแนน</label>
                <div className="form-input bg-slate-100 text-slate-500">
                  {form.rating ? `⭐ ${form.rating}` : 'ยังไม่มีรีวิว (ระบบเก็บรีวิวจริงยังไม่เปิดใช้งาน)'}
                </div>
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
              <label className="form-label">LINE User ID</label>
              <input
                className="form-input font-mono text-xs"
                value={form.line_user_id}
                onChange={(e) => setForm({ ...form, line_user_id: e.target.value })}
                placeholder="U1234567890abcdef1234567890abcdef"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                ใช้ส่งงาน (เช็คอิน-เช็คเอาท์-ชื่อผู้เข้าพัก) ให้พาร์ทเนอร์ทาง LINE โดยตรง ไม่ผูกอัตโนมัติ ต้องกรอกเอง
              </p>
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
                <div className="mt-2 flex items-center gap-3">
                  <Image
                    src={form.cover_image_url}
                    alt=""
                    width={80}
                    height={80}
                    className="h-20 w-20 rounded-lg object-cover"
                    unoptimized
                  />
                  <button
                    type="button"
                    onClick={handleRemoveCoverImage}
                    disabled={uploading}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 disabled:opacity-50"
                  >
                    ลบรูป
                  </button>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-3">
              <div>
                <label className="form-label">ที่อยู่</label>
                <input
                  className="form-input"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="เลขที่ ถนน ตำบล อำเภอ จังหวัด"
                />
              </div>

              <div>
                <label className="form-label">ลิงก์ Google Maps</label>
                <div className="flex gap-2">
                  <input
                    className="form-input flex-1"
                    value={form.google_maps_url}
                    onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })}
                    placeholder="https://maps.app.goo.gl/... หรือ https://www.google.com/maps/place/..."
                  />
                  <button
                    type="button"
                    onClick={handleResolveLocation}
                    disabled={resolvingLocation || !form.id}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm whitespace-nowrap disabled:opacity-50"
                    title={!form.id ? 'บันทึกพาร์ทเนอร์ก่อน แล้วค่อย resolve ได้' : undefined}
                  >
                    {resolvingLocation ? 'กำลัง Resolve...' : 'Resolve'}
                  </button>
                </div>
                {!form.id ? (
                  <p className="mt-1 text-xs text-slate-400">บันทึกพาร์ทเนอร์นี้ก่อน ถึงจะ resolve ตำแหน่งได้</p>
                ) : null}
                {resolveError ? <p className="mt-1 text-xs text-red-500">{resolveError}</p> : null}
              </div>

              {form.latitude != null && form.longitude != null ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-slate-700">
                        {form.latitude.toFixed(6)}, {form.longitude.toFixed(6)}
                      </p>
                      <a
                        href={`https://www.google.com/maps?q=${form.latitude},${form.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary-dark hover:underline"
                      >
                        ดูใน Google Maps →
                      </a>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        form.location_status === 'verified'
                          ? 'bg-emerald-100 text-emerald-700'
                          : form.location_status === 'rejected'
                            ? 'bg-red-100 text-red-600'
                            : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {form.location_status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    ที่มา: {form.location_source ?? '-'}
                    {form.location_resolved_at
                      ? ` · resolve เมื่อ ${new Date(form.location_resolved_at).toLocaleString('th-TH')}`
                      : ''}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleSetLocationStatus('verified')}
                      disabled={updatingLocationStatus || form.location_status === 'verified'}
                      className="rounded-lg bg-emerald-500 px-3 py-1 text-xs text-white disabled:opacity-50"
                    >
                      ✓ Verify
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetLocationStatus('rejected')}
                      disabled={updatingLocationStatus || form.location_status === 'rejected'}
                      className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 disabled:opacity-50"
                    >
                      ✕ Reject
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    ต้อง verify ก่อนเท่านั้น ถึงจะขึ้นแสดงบนแผนที่สาธารณะได้ (ดู 047 nearby_partners)
                  </p>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-3">
              <div>
                <label className="form-label">การเข้าสู่ระบบพอร์ทัล</label>
                <p className="mt-0.5 text-xs text-slate-400">
                  สร้างบัญชีให้พาร์ทเนอร์ล็อกอินเข้าพอร์ทัลได้ในอนาคต — ระบบจะ{' '}
                  <span className="font-medium">ไม่ส่งอีเมลเชิญอัตโนมัติ</span> คุณจะได้ลิงก์มาคัดลอกไปส่งเอง
                  (LINE, WhatsApp, อีเมลส่วนตัว ฯลฯ)
                </p>
              </div>

              {form.id ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-700">เข้าดูแทนพาร์ทเนอร์</p>
                    <p className="text-xs text-slate-400">
                      เปิดพอร์ทัลในแท็บใหม่ โดยล็อกอินเป็นบัญชีพาร์ทเนอร์นี้จริง ๆ (สำหรับตรวจสอบ/ช่วยเหลือ) —
                      บันทึกลง audit log ทุกครั้ง
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleImpersonate}
                    disabled={impersonating}
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm whitespace-nowrap disabled:opacity-50"
                  >
                    {impersonating ? 'กำลังเปิด...' : '🔑 เข้าดูแทน'}
                  </button>
                </div>
              ) : null}
              {impersonateError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                  {impersonateError}
                </div>
              ) : null}

              {!form.id ? (
                <p className="text-xs text-slate-400">บันทึกพาร์ทเนอร์นี้ก่อน ถึงจะสร้างบัญชีเข้าสู่ระบบได้</p>
              ) : portalInviteLink ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <p className="mb-1 text-emerald-700">สร้างลิงก์สำเร็จ — คัดลอกไปส่งให้พาร์ทเนอร์ได้เลย:</p>
                  <div className="flex gap-2">
                    <input readOnly className="form-input flex-1 text-xs" value={portalInviteLink} />
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(portalInviteLink)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm whitespace-nowrap"
                    >
                      คัดลอก
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">ชื่อองค์กร</label>
                      <input
                        className="form-input"
                        value={portalForm.organizationName}
                        onChange={(e) => setPortalForm({ ...portalForm, organizationName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="form-label">ชื่อสาขา</label>
                      <input
                        className="form-input"
                        value={portalForm.branchName}
                        onChange={(e) => setPortalForm({ ...portalForm, branchName: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">ชื่อผู้ติดต่อ</label>
                      <input
                        className="form-input"
                        value={portalForm.contactName}
                        onChange={(e) => setPortalForm({ ...portalForm, contactName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="form-label">เบอร์โทร (ถ้ามี)</label>
                      <input
                        className="form-input"
                        value={portalForm.contactPhone}
                        onChange={(e) => setPortalForm({ ...portalForm, contactPhone: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">อีเมลผู้ติดต่อ</label>
                    <input
                      type="email"
                      className="form-input"
                      value={portalForm.contactEmail}
                      onChange={(e) => setPortalForm({ ...portalForm, contactEmail: e.target.value })}
                    />
                  </div>

                  {portalError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                      {portalError}
                      {portalExistingEmail ? (
                        <button
                          type="button"
                          onClick={() => handleResendPortalLink(portalExistingEmail)}
                          disabled={portalCreating}
                          className="ml-2 underline disabled:opacity-50"
                        >
                          ขอลิงก์ใหม่สำหรับ {portalExistingEmail}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={handleCreatePortalAccess}
                    disabled={portalCreating}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    {portalCreating ? 'กำลังสร้าง...' : 'สร้างบัญชีเข้าสู่ระบบ (ไม่ส่งอีเมล)'}
                  </button>
                </>
              )}
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
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex h-16 items-center rounded-lg border border-slate-200 bg-white px-3">
                    <Image
                      src={form.logo_url}
                      alt=""
                      width={160}
                      height={64}
                      className="max-h-12 w-auto object-contain"
                      unoptimized
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveLogoImage}
                    disabled={uploading}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 disabled:opacity-50"
                  >
                    ลบโลโก้
                  </button>
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

      {/* ===== ยืนยันลบถาวร ===== */}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6">
            <h3 className="text-base font-bold text-red-700">ลบพาร์ทเนอร์ถาวร: {deleteTarget.name}</h3>
            <p className="text-xs text-slate-500">
              การลบนี้ถาวร ย้อนกลับไม่ได้ — จะลบ Organization, สาขา, บัญชีเข้าสู่ระบบของพอร์ทัล และข้อมูลพาร์ทเนอร์
              ทั้งหมด ถ้าต้องการแค่ซ่อน/ปิดการใช้งานชั่วคราว ให้ใช้ปุ่ม &quot;ระงับ&quot; แทน — ยกเลิกการลบนี้ไม่ได้
              หลังกดยืนยัน
            </p>

            {deletePrecheckLoading ? (
              <p className="text-sm text-slate-400">กำลังตรวจสอบข้อมูลที่ผูกอยู่...</p>
            ) : deletePrecheckError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {deletePrecheckError}
              </div>
            ) : deletePrecheck ? (
              <>
                <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <p>
                    จะลบ: Organization {deletePrecheck.willDelete.organizations} รายการ ·
                    สาขา {deletePrecheck.willDelete.branches} รายการ ·
                    บัญชีพอร์ทัล {deletePrecheck.willDelete.portalUsers} บัญชี
                  </p>
                  <p>
                    Deposit rules {deletePrecheck.willDelete.depositRules} · Settlements{' '}
                    {deletePrecheck.willDelete.settlements}
                  </p>
                  {deletePrecheck.warnings.patients > 0 ||
                  deletePrecheck.warnings.documents > 0 ||
                  deletePrecheck.warnings.subscriptions > 0 ? (
                    <p className="text-amber-600">
                      ⚠️ ผูกกับ patients {deletePrecheck.warnings.patients} · documents{' '}
                      {deletePrecheck.warnings.documents} · subscriptions{' '}
                      {deletePrecheck.warnings.subscriptions} (จะถูกลบตามไปด้วยแบบ cascade)
                    </p>
                  ) : null}
                </div>

                {!deletePrecheck.canDelete ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                    {deletePrecheck.blockingReason}
                  </div>
                ) : (
                  <div>
                    <label className="form-label">
                      พิมพ์ชื่อพาร์ทเนอร์ &quot;{deleteTarget.name}&quot; ให้ตรงทุกตัวอักษรเพื่อยืนยัน
                    </label>
                    <input
                      className="form-input"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={deleteTarget.name}
                      autoComplete="off"
                    />
                  </div>
                )}

                {deleteError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                    {deleteError}
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleting}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmHardDelete}
                disabled={
                  deleting ||
                  deletePrecheckLoading ||
                  !deletePrecheck?.canDelete ||
                  deleteConfirmText.trim() !== deleteTarget.name
                }
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                {deleting ? 'กำลังลบ...' : 'ลบถาวร'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
