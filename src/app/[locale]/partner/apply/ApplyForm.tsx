"use client";

// app/[locale]/partner/apply/ApplyForm.tsx
//
// เขียนลง table 'cases' แบบเดียวกับ BecomePartnerForm.tsx (ไม่ใช้
// app/api/partner/apply/route.ts + ตาราง partner_applications ที่แพ็กเกจ
// เดิมสร้างมา) เพราะ admin's PartnerLeadsManager.tsx อ่าน B2B lead จาก
// cases table ที่ service_type ขึ้นต้นด้วย "[B2B]" เท่านั้น — ถ้าเขียนลง
// ตารางใหม่ ใบสมัครจะไม่โผล่ในแอดมินเลย ฟอร์มนี้จึงเก็บ field ที่ cases
// ไม่มีคอลัมน์รองรับ (เลขทะเบียน, ผู้ติดต่อ, consent ฯลฯ) ไว้ใน message
// แบบ structured text แทน ไม่มี field ไหนหายไป
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PartnerPageContent } from "@/content/partner/types";

// ผูกกับ BUSINESS_TYPE_LABEL ใน src/components/admin/PartnerLeadsManager.tsx
// (ต้อง sync กันสองที่นี้ถ้าจะเพิ่ม/แก้ประเภทธุรกิจ)
const BUSINESS_TYPE_TO_LABEL_KEY: Record<string, string> = {
  HOSPITAL: "hospital",
  CLINIC: "clinic",
  HOTEL: "hotel",
  TRANSPORT: "transport",
  CORPORATE: "corporate",
  WELLNESS_SPA: "wellness_spa",
};

interface FormState {
  companyName: string;
  registrationNumber: string;
  taxId: string;
  businessType: string;
  yearEstablished: string;
  employeeCount: string;
  primaryName: string;
  primaryTitle: string;
  primaryEmail: string;
  primaryPhone: string;
  primaryLineId: string;
  address: string;
  district: string;
  province: string;
  postalCode: string;
  serviceTypes: string;
  languages: string;
  operatingHours: string;
  capacity: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptSLA: boolean;
}

const initialState: FormState = {
  companyName: "",
  registrationNumber: "",
  taxId: "",
  businessType: "",
  yearEstablished: "",
  employeeCount: "",
  primaryName: "",
  primaryTitle: "",
  primaryEmail: "",
  primaryPhone: "",
  primaryLineId: "",
  address: "",
  district: "",
  province: "",
  postalCode: "",
  serviceTypes: "",
  languages: "",
  operatingHours: "",
  capacity: "",
  acceptTerms: false,
  acceptPrivacy: false,
  acceptSLA: false,
};

type Status = "idle" | "submitting" | "success" | "error";

export function ApplyForm({ content }: { content: PartnerPageContent }) {
  const { fields, sections, consent, ...copy } = content.applyForm;
  const [form, setForm] = useState<FormState>(initialState);
  const [status, setStatus] = useState<Status>("idle");
  const supabase = createClient();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    // รูปแบบ payload เดียวกับ BecomePartnerForm.tsx ทุกประการ (patient_name /
    // service_type prefix "[B2B]" / status "new_lead_b2b") เพื่อให้
    // PartnerLeadsManager.tsx ในแอดมินอ่านเจอโดยไม่ต้องแก้อะไรที่ฝั่งแอดมิน
    const businessTypeKey = BUSINESS_TYPE_TO_LABEL_KEY[form.businessType] || form.businessType;
    const extraDetails = [
      form.registrationNumber && `Reg. No: ${form.registrationNumber}`,
      form.taxId && `Tax ID: ${form.taxId}`,
      form.yearEstablished && `Established: ${form.yearEstablished}`,
      form.employeeCount && `Employees: ${form.employeeCount}`,
      form.primaryName && `Contact: ${form.primaryName}${form.primaryTitle ? ` (${form.primaryTitle})` : ""}`,
      form.primaryLineId && `LINE: ${form.primaryLineId}`,
      [form.address, form.district, form.province, form.postalCode].filter(Boolean).join(", "),
      form.serviceTypes && `Services: ${form.serviceTypes}`,
      form.languages && `Languages: ${form.languages}`,
      form.operatingHours && `Hours: ${form.operatingHours}`,
      form.capacity && `Capacity: ${form.capacity}`,
    ]
      .filter(Boolean)
      .join("\n");

    const payload = {
      patient_name: `${form.primaryName.trim()} (${form.companyName.trim()})`,
      phone_number: form.primaryPhone.trim(),
      service_type: `[B2B] ${businessTypeKey}`,
      hospital: form.companyName.trim(),
      travel_date: null,
      message: extraDetails || null,
      status: "new_lead_b2b",
      created_at: new Date().toISOString(),
    };

    try {
      const { error } = await supabase.from("cases").insert([payload]);
      if (error) throw error;
      setStatus("success");
      setForm(initialState);
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="wos-doc" role="status">
        <span className="wos-doc-stamp">Sent</span>
        <h2 className="wos-pass-headline">{copy.successTitle}</h2>
        <p className="wos-stub-desc">{copy.successBody}</p>
      </div>
    );
  }

  return (
    <form className="wos-doc" onSubmit={handleSubmit} noValidate>
      <span className="wos-doc-stamp">Application</span>

      {/* Company */}
      <h3 className="wos-pass-headline">{sections.company}</h3>
      <div className="wos-form-grid">
        <label className="wos-field">
          <span>{fields.companyName}</span>
          <input
            required
            value={form.companyName}
            onChange={(e) => update("companyName", e.target.value)}
          />
        </label>
        <label className="wos-field">
          <span>{fields.businessType}</span>
          <select
            required
            value={form.businessType}
            onChange={(e) => update("businessType", e.target.value)}
          >
            <option value="" disabled>
              —
            </option>
            {fields.businessTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wos-field">
          <span>{fields.registrationNumber}</span>
          <input value={form.registrationNumber} onChange={(e) => update("registrationNumber", e.target.value)} />
        </label>
        <label className="wos-field">
          <span>{fields.taxId}</span>
          <input value={form.taxId} onChange={(e) => update("taxId", e.target.value)} />
        </label>
        <label className="wos-field">
          <span>{fields.yearEstablished}</span>
          <input
            type="number"
            value={form.yearEstablished}
            onChange={(e) => update("yearEstablished", e.target.value)}
          />
        </label>
        <label className="wos-field">
          <span>{fields.employeeCount}</span>
          <input
            type="number"
            value={form.employeeCount}
            onChange={(e) => update("employeeCount", e.target.value)}
          />
        </label>
      </div>

      {/* Contact */}
      <h3 className="wos-pass-headline" style={{ marginTop: 28 }}>
        {sections.contact}
      </h3>
      <div className="wos-form-grid">
        <label className="wos-field">
          <span>{fields.primaryName}</span>
          <input required value={form.primaryName} onChange={(e) => update("primaryName", e.target.value)} />
        </label>
        <label className="wos-field">
          <span>{fields.primaryTitle}</span>
          <input value={form.primaryTitle} onChange={(e) => update("primaryTitle", e.target.value)} />
        </label>
        <label className="wos-field">
          <span>{fields.primaryEmail}</span>
          <input
            required
            type="email"
            value={form.primaryEmail}
            onChange={(e) => update("primaryEmail", e.target.value)}
          />
        </label>
        <label className="wos-field">
          <span>{fields.primaryPhone}</span>
          <input
            required
            type="tel"
            value={form.primaryPhone}
            onChange={(e) => update("primaryPhone", e.target.value)}
          />
        </label>
        <label className="wos-field">
          <span>{fields.primaryLineId}</span>
          <input value={form.primaryLineId} onChange={(e) => update("primaryLineId", e.target.value)} />
        </label>
        <label className="wos-field wos-field-wide">
          <span>{fields.address}</span>
          <input required value={form.address} onChange={(e) => update("address", e.target.value)} />
        </label>
        <label className="wos-field">
          <span>{fields.district}</span>
          <input value={form.district} onChange={(e) => update("district", e.target.value)} />
        </label>
        <label className="wos-field">
          <span>{fields.province}</span>
          <input required value={form.province} onChange={(e) => update("province", e.target.value)} />
        </label>
        <label className="wos-field">
          <span>{fields.postalCode}</span>
          <input value={form.postalCode} onChange={(e) => update("postalCode", e.target.value)} />
        </label>
      </div>

      {/* Services */}
      <h3 className="wos-pass-headline" style={{ marginTop: 28 }}>
        {sections.services}
      </h3>
      <div className="wos-form-grid">
        <label className="wos-field wos-field-wide">
          <span>{fields.serviceTypes}</span>
          <input
            placeholder="e.g. Dental, Aesthetic, Physical Therapy"
            value={form.serviceTypes}
            onChange={(e) => update("serviceTypes", e.target.value)}
          />
        </label>
        <label className="wos-field">
          <span>{fields.languages}</span>
          <input value={form.languages} onChange={(e) => update("languages", e.target.value)} />
        </label>
        <label className="wos-field">
          <span>{fields.operatingHours}</span>
          <input value={form.operatingHours} onChange={(e) => update("operatingHours", e.target.value)} />
        </label>
        <label className="wos-field">
          <span>{fields.capacity}</span>
          <input type="number" value={form.capacity} onChange={(e) => update("capacity", e.target.value)} />
        </label>
      </div>

      {/* Consent */}
      <h3 className="wos-pass-headline" style={{ marginTop: 28 }}>
        {sections.consent}
      </h3>
      <div className="wos-consent-list">
        <label className="wos-checkbox">
          <input
            type="checkbox"
            required
            checked={form.acceptTerms}
            onChange={(e) => update("acceptTerms", e.target.checked)}
          />
          <span>{consent.acceptTerms}</span>
        </label>
        <label className="wos-checkbox">
          <input
            type="checkbox"
            required
            checked={form.acceptPrivacy}
            onChange={(e) => update("acceptPrivacy", e.target.checked)}
          />
          <span>{consent.acceptPrivacy}</span>
        </label>
        <label className="wos-checkbox">
          <input
            type="checkbox"
            required
            checked={form.acceptSLA}
            onChange={(e) => update("acceptSLA", e.target.checked)}
          />
          <span>{consent.acceptSLA}</span>
        </label>
      </div>

      {status === "error" && (
        <p className="wos-disclaimer" role="alert" style={{ color: "var(--wos-stamp)" }}>
          {copy.errorTitle} — {copy.errorBody}
        </p>
      )}

      <button type="submit" className="wos-btn" disabled={status === "submitting"} style={{ marginTop: 24 }}>
        {status === "submitting" ? copy.submittingLabel : copy.submitLabel}
      </button>
    </form>
  );
}
