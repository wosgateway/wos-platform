// src/components/partner/MouSignForm.tsx
//
// Drives the sign flow for /partner/mou-sign/[token]:
//   1. load sign-request info (org name, masked email)
//   2. request OTP -> enter code -> pre-check (non-consuming)
//   3. draw signature
//   4. confirm (re-submits the code, which is consumed server-side —
//      see src/app/api/mou-sign/[token]/confirm/route.ts's header)
//
// All state is in-memory only — no localStorage/sessionStorage per this
// environment's artifact rules, and there's no reason to persist a
// half-finished legal signature across page reloads anyway; a refresh
// simply restarts the flow from step 1 against the same token.

'use client';

import { useEffect, useRef, useState } from 'react';
import { SignatureCanvas, type SignatureCanvasHandle } from './SignatureCanvas';

type Step = 'loading' | 'error' | 'preview' | 'otp' | 'sign' | 'done';

interface SignRequestInfo {
  organizationName: string;
  signerName: string;
  signerEmailMasked: string | null;
  hasEmail: boolean;
}

const OTP_ERROR_LABEL: Record<string, string> = {
  no_active_code: 'ยังไม่ได้ขอรหัสยืนยัน กรุณากดขอรหัสอีกครั้ง',
  expired: 'รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่',
  too_many_attempts: 'กรอกรหัสผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่',
  incorrect: 'รหัสไม่ถูกต้อง',
  invalid_code_format: 'กรุณากรอกรหัส 6 หลัก',
};

const REQUEST_ERROR_LABEL: Record<string, string> = {
  not_found: 'ไม่พบลิงก์ลงนามนี้ กรุณาตรวจสอบลิงก์อีกครั้ง',
  expired: 'ลิงก์นี้หมดอายุแล้ว กรุณาติดต่อทีมงาน WOS เพื่อขอลิงก์ใหม่',
  already_signed: 'เอกสารนี้ถูกลงนามไปแล้ว',
  cancelled: 'ลิงก์นี้ถูกยกเลิกแล้ว',
  invalid_token: 'ลิงก์ไม่ถูกต้อง',
  lookup_failed: 'เกิดข้อผิดพลาด กรุณาลองใหม่ภายหลัง',
};

export function MouSignForm({ token }: { token: string }) {
  const [step, setStep] = useState<Step>('loading');
  const [info, setInfo] = useState<SignRequestInfo | null>(null);
  const [errorLabel, setErrorLabel] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpChecked, setOtpChecked] = useState(false);

  const [signerName, setSignerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);

  const sigRef = useRef<SignatureCanvasHandle>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/mou-sign/${token}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setErrorLabel(REQUEST_ERROR_LABEL[data.error] ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่ภายหลัง');
          setStep('error');
          return;
        }
        setInfo(data);
        setSignerName(data.signerName ?? '');
        setStep('preview');
      })
      .catch(() => {
        if (!cancelled) {
          setErrorLabel('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่ภายหลัง');
          setStep('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleRequestOtp() {
    setOtpSending(true);
    setOtpError(null);
    try {
      const res = await fetch(`/api/mou-sign/${token}/otp/request`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(data.error === 'no_email_on_file' ? 'ไม่พบอีเมลสำหรับส่งรหัส' : 'ส่งรหัสไม่สำเร็จ');
        return;
      }
      setStep('otp');
    } catch {
      setOtpError('เชื่อมต่อไม่สำเร็จ');
    } finally {
      setOtpSending(false);
    }
  }

  async function handleCheckOtp() {
    setOtpError(null);
    try {
      const res = await fetch(`/api/mou-sign/${token}/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(OTP_ERROR_LABEL[data.error] ?? 'ยืนยันรหัสไม่สำเร็จ');
        return;
      }
      setOtpChecked(true);
      setStep('sign');
    } catch {
      setOtpError('เชื่อมต่อไม่สำเร็จ');
    }
  }

  async function handleConfirmSignature() {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setOtpError('กรุณาจรดลายเซ็นก่อนยืนยัน');
      return;
    }
    if (!signerName.trim()) {
      setOtpError('กรุณากรอกชื่อผู้ลงนาม');
      return;
    }

    setSubmitting(true);
    setOtpError(null);
    try {
      const res = await fetch(`/api/mou-sign/${token}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          signatureImagePngBase64: sigRef.current.toPngBase64(),
          signerName: signerName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(OTP_ERROR_LABEL[data.error] ?? data.error ?? 'ลงนามไม่สำเร็จ กรุณาลองใหม่');
        // A consumed/expired/incorrect code here means the earlier
        // pre-check and the final check disagreed (e.g. code expired
        // in between) — send the signer back to request a fresh one
        // rather than letting them retry a dead code forever.
        if (['no_active_code', 'expired', 'too_many_attempts', 'incorrect'].includes(data.error)) {
          setStep('otp');
          setOtpChecked(false);
          setCode('');
        }
        return;
      }
      if (data.emailWarning) setSubmitWarning(data.emailWarning);
      setStep('done');
    } catch {
      setOtpError('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'loading') {
    return <div className="p-10 text-center text-sm text-slate-400">⏳ กำลังโหลด...</div>;
  }

  if (step === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">
        {errorLabel}
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <p className="text-2xl mb-2">✅</p>
        <p className="font-semibold text-emerald-700">ลงนามข้อตกลงเรียบร้อยแล้ว</p>
        <p className="mt-2 text-sm text-slate-500">
          ระบบได้ส่งเอกสารฉบับลงนามไปยังอีเมลของท่านเรียบร้อยแล้ว ขอบคุณที่ร่วมเป็น WOS Founding Partner
        </p>
        {submitWarning && (
          <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-700">
            ⚠️ {submitWarning}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-100 shadow-card p-6">
        <h2 className="text-lg font-bold text-slate-900">WOS Founding Partner Program — MOU</h2>
        <p className="mt-1 text-sm text-slate-500">
          {info?.organizationName} · ผู้ลงนาม: {info?.signerName}
        </p>
        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500">
          📄 กรุณาอ่านข้อตกลง MOU ฉบับเต็มก่อนลงนาม — เอกสารนี้ระบุขอบเขตความร่วมมือ, Commercial Fee,
          และเงื่อนไขของ Founding Partner Program ระหว่าง WOS และท่าน
          <div className="mt-2 flex gap-3">
            <a
              href={`/api/mou-sign/${token}/template`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-700 hover:underline"
            >
              👁️ ดูฉบับร่าง MOU (PDF)
            </a>
            <a
              href={`/api/mou-sign/${token}/template?download=1`}
              className="font-medium text-emerald-700 hover:underline"
            >
              ⬇️ ดาวน์โหลด
            </a>
          </div>
        </div>
      </div>

      {step === 'preview' && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-6 space-y-4">
          <p className="text-sm text-slate-600">
            เพื่อยืนยันตัวตนก่อนลงนาม ระบบจะส่งรหัสยืนยัน (OTP) ไปยังอีเมล{' '}
            <strong>{info?.signerEmailMasked ?? '-'}</strong>
          </p>
          {otpError && <p className="text-sm text-red-500">{otpError}</p>}
          <button
            onClick={handleRequestOtp}
            disabled={otpSending || !info?.hasEmail}
            className="btn-primary text-sm disabled:opacity-60"
          >
            {otpSending ? '⏳ กำลังส่งรหัส...' : '📧 ส่งรหัสยืนยันไปยังอีเมล'}
          </button>
        </div>
      )}

      {step === 'otp' && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-6 space-y-4">
          <label className="form-label">กรอกรหัสยืนยัน (OTP) 6 หลัก</label>
          <input
            className="form-input tracking-widest text-center text-lg"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
          />
          {otpError && <p className="text-sm text-red-500">{otpError}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={handleCheckOtp}
              disabled={code.length !== 6}
              className="btn-primary text-sm disabled:opacity-60"
            >
              ยืนยันรหัส
            </button>
            <button onClick={handleRequestOtp} disabled={otpSending} className="text-xs text-slate-400 hover:underline">
              ส่งรหัสใหม่อีกครั้ง
            </button>
          </div>
        </div>
      )}

      {step === 'sign' && otpChecked && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-6 space-y-4">
          <div>
            <label className="form-label">ชื่อผู้ลงนาม</label>
            <input
              className="form-input"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">ลายเซ็น</label>
            <SignatureCanvas ref={sigRef} />
            <button
              type="button"
              onClick={() => sigRef.current?.clear()}
              className="mt-1 text-xs text-slate-400 hover:underline"
            >
              🗑️ ล้างลายเซ็น
            </button>
          </div>
          {otpError && <p className="text-sm text-red-500">{otpError}</p>}
          <button
            onClick={handleConfirmSignature}
            disabled={submitting}
            className="btn-primary text-sm disabled:opacity-60"
          >
            {submitting ? '⏳ กำลังบันทึกลายเซ็น...' : '✅ ยืนยันการลงนาม (Confirm Signature)'}
          </button>
        </div>
      )}
    </div>
  );
}
