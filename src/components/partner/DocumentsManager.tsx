// src/components/partner/DocumentsManager.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Document {
  id: string;
  name: string;
  file_url: string;
  file_type: string | null;
  category: string | null;
  description: string | null;
  expiry_date: string | null;
  status: 'active' | 'expired';
  created_at: string;
}

const CATEGORY_OPTIONS = [
  { value: 'license', label: '📜 ใบอนุญาต' },
  { value: 'contract', label: '📝 สัญญา' },
  { value: 'certificate', label: '🏆 ประกาศนียบัตร' },
  { value: 'other', label: '📎 อื่นๆ' },
];

export function DocumentsManager({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}) {
  const supabase = createClient();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function loadDocuments() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('documents')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    setLoading(false);

    if (fetchError) {
      setError('โหลดข้อมูลไม่สำเร็จ: ' + fetchError.message);
      return;
    }

    setDocuments(data as Document[]);
  }

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement;
    const nameInput = form.querySelector('input[name="name"]') as HTMLInputElement;
    const categorySelect = form.querySelector('select[name="category"]') as HTMLSelectElement;
    const expiryInput = form.querySelector('input[name="expiry"]') as HTMLInputElement;

    if (!fileInput.files?.length) {
      setError('กรุณาเลือกไฟล์');
      return;
    }

    const file = fileInput.files[0];
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (file.size > maxSize) {
      setError('ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 10MB)');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const path = `documents/${organizationId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      // หมายเหตุ: supabase-js storage.upload() ไม่รองรับ onUploadProgress
      // จึงตัด progress bar ออก แสดงแค่สถานะ "กำลังอัปโหลด..." แทน
      const { error: uploadError } = await supabase.storage
        .from('partner-images')
        .upload(path, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('partner-images').getPublicUrl(path);

      const payload = {
        organization_id: organizationId,
        name: nameInput.value.trim() || file.name,
        file_url: data.publicUrl,
        file_type: file.type || null,
        file_size: file.size,
        category: categorySelect.value || null,
        expiry_date: expiryInput.value || null,
        uploaded_by: userId,
        status: 'active',
      };

      const { error: insertError } = await supabase.from('documents').insert(payload);

      if (insertError) throw insertError;

      form.reset();
      loadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('ลบเอกสารนี้?')) return;

    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId);

    if (deleteError) {
      alert('ลบไม่สำเร็จ: ' + deleteError.message);
      return;
    }

    loadDocuments();
  }

  const categoryLabels = CATEGORY_OPTIONS.reduce((acc, c) => ({ ...acc, [c.value]: c.label }), {});

  return (
    <div className="space-y-6">
      {/* Upload Form */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-card p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">📤 อัปโหลดเอกสารใหม่</h3>

        <form onSubmit={handleUpload} className="space-y-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="form-label">ชื่อเอกสาร</label>
              <input
                name="name"
                className="form-input"
                placeholder="เช่น ใบอนุญาตประกอบกิจการ 2567"
              />
            </div>

            <div>
              <label className="form-label">หมวดหมู่</label>
              <select name="category" className="form-input">
                {CATEGORY_OPTIONS.map((cat) => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">ไฟล์ *</label>
              <input
                type="file"
                className="form-input"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                required
              />
              <p className="mt-1 text-xs text-slate-400">รองรับ PDF, JPG, PNG, DOC (สูงสุด 10MB)</p>
            </div>

            <div>
              <label className="form-label">วันหมดอายุ (ถ้ามี)</label>
              <input
                type="date"
                name="expiry"
                className="form-input"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={uploading}
              className="btn-primary text-sm disabled:opacity-60"
            >
              {uploading ? '⏳ กำลังอัปโหลด...' : '📤 อัปโหลด'}
            </button>
          </div>
        </form>
      </div>

      {/* Document List */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-card">
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">
            📂 เอกสารทั้งหมด ({documents.length})
          </h3>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            📭 ยังไม่มีเอกสาร
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {documents.map((doc) => {
              const isExpired = doc.expiry_date && new Date(doc.expiry_date) < new Date();
              const displayStatus = isExpired ? 'expired' : doc.status;

              return (
                <div key={doc.id} className="flex items-center justify-between p-4 hover:bg-slate-50">
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-2xl">
                      {doc.file_type?.includes('pdf') ? '📄' :
                       doc.file_type?.includes('image') ? '🖼️' :
                       doc.file_type?.includes('word') ? '📝' : '📎'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 truncate">{doc.name}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span>{categoryLabels[doc.category as keyof typeof categoryLabels] || doc.category}</span>
                        {doc.expiry_date && (
                          <span className={isExpired ? 'text-red-500' : ''}>
                            🗓️ หมดอายุ: {new Date(doc.expiry_date).toLocaleDateString('th-TH')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      displayStatus === 'expired'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-emerald-100 text-emerald-600'
                    }`}>
                      {displayStatus === 'expired' ? '⏰ หมดอายุ' : '✅ ปกติ'}
                    </span>
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-xs"
                    >
                      👁️ ดู
                    </a>
                    <a
                      href={doc.file_url}
                      download
                      className="text-slate-500 hover:text-primary text-xs"
                    >
                      ⬇️
                    </a>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="text-red-400 hover:text-red-600 text-xs"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
