// src/lib/notify/consultation-notify.ts
//
// Phase 5 of "ปรึกษา WOS ฟรี" — email notification to the WOS team when
// a new consultation request lands. Resolves the
// "Notification (Phase 5) intentionally not wired in yet" comment in
// src/app/api/consultation/route.ts's POST handler.
//
// Follows the exact same fire-and-forget contract as notifyNewOrder()
// in order-notify.ts: a notification failure must NEVER fail or roll
// back the consultation_requests insert that has already succeeded by
// the time this runs. Every send resolves, never throws — see the call
// site in route.ts, which fires this without awaiting it.
//
// Uses Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email)
// directly via fetch — no SDK/new dependency, same approach
// sendTelegram()/sendLineMessage() in order-notify.ts already use for
// their APIs. Swapping to a different provider later (SES, Postmark,
// SendGrid, ...) only touches sendEmail() below; buildEmailSubject/
// buildEmailHtml/buildEmailText and the route.ts call site don't change.
//
// Two channels, each independently optional — same "missing any one
// required env var = silent no-op for that channel" convention
// order-notify.ts uses, so local/dev/preview environments don't need
// any of this configured:
//   RESEND_API_KEY                 Resend API key (dashboard > API Keys)
//   CONSULTATION_NOTIFY_EMAIL_TO    WOS team inbox that should receive
//                                   new leads (comma-separated for
//                                   multiple recipients — Resend accepts
//                                   an array; a single string is split
//                                   below so this env var stays simple
//                                   to set in any hosting dashboard)
//   CONSULTATION_NOTIFY_EMAIL_FROM  verified sender, e.g.
//                                   "WOS Leads <leads@notify.wos.asia>"
//                                   — must be on a domain verified in
//                                   the Resend dashboard or sends 403.
//   TELEGRAM_BOT_TOKEN +
//   TELEGRAM_CHAT_ID                Same bot/chat order-notify.ts's
//                                   sendTelegram() already uses for new
//                                   orders — one bot, both lead types
//                                   land in the same chat instead of
//                                   needing a second bot just for this.

// Matches NEXT_PUBLIC_APP_URL convention already used for outbound links
// in src/app/api/admin/send-quotation/route.tsx.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';

// Keep in sync with the label maps in ConsultationsManager.tsx and the
// CHECK constraints in 091_consultation_requests.sql.
const CONTACT_CHANNEL_LABEL: Record<string, string> = {
  phone: 'โทรศัพท์',
  whatsapp: 'WhatsApp',
  line: 'LINE',
  email: 'อีเมล',
  other: 'อื่นๆ',
};

const REQUEST_TYPE_LABEL: Record<string, string> = {
  health_checkup: 'ตรวจสุขภาพ',
  medical_treatment: 'รักษาพยาบาล',
  dental: 'ทันตกรรม',
  wellness: 'เวลเนส',
  aesthetic: 'ความงาม',
  hospital_clinic: 'โรงพยาบาล/คลินิก',
  hotel: 'โรงแรมที่พัก',
  transport: 'รถรับส่ง',
  not_sure: 'ยังไม่แน่ใจ',
};

const TRAVEL_PERIOD_LABEL: Record<string, string> = {
  unspecified: 'ยังไม่กำหนด',
  within_1_month: 'ภายใน 1 เดือน',
  '1_to_3_months': '1-3 เดือน',
  more_than_3_months: 'มากกว่า 3 เดือน',
};

const SOURCE_LABEL: Record<string, string> = {
  homepage_hero: 'Homepage (บนสุด)',
  homepage_bottom: 'Homepage (ล่างสุด)',
  partner_page: 'หน้าพันธมิตร',
  package_page: 'หน้าแพ็กเกจ',
  knowledge_center: 'Knowledge Center',
  unknown: 'ไม่ทราบที่มา',
};

export interface NotifyConsultationPayload {
  id: string;
  name: string;
  contactChannel: string;
  contactValue: string;
  country: string;
  requestTypes: string[];
  message: string | null;
  travelPeriod: string;
  source: string;
  utmCampaign: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function adminUrl(): string {
  return `${APP_URL}/admin?tab=consultations`;
}

function buildEmailSubject(payload: NotifyConsultationPayload): string {
  return `🆕 ปรึกษา WOS ฟรี — ${payload.name} (${payload.country})`;
}

function buildEmailText(payload: NotifyConsultationPayload): string {
  const requestTypes = payload.requestTypes.map((t) => REQUEST_TYPE_LABEL[t] ?? t).join(', ');
  return [
    `🆕 คำขอปรึกษาใหม่จากฟอร์ม "ปรึกษา WOS ฟรี"`,
    ``,
    `ชื่อ: ${payload.name}`,
    `ประเทศ: ${payload.country}`,
    `ติดต่อ: ${CONTACT_CHANNEL_LABEL[payload.contactChannel] ?? payload.contactChannel} — ${payload.contactValue}`,
    `สนใจ: ${requestTypes || '-'}`,
    `ช่วงเวลาเดินทาง: ${TRAVEL_PERIOD_LABEL[payload.travelPeriod] ?? payload.travelPeriod}`,
    `ที่มา: ${SOURCE_LABEL[payload.source] ?? payload.source}${payload.utmCampaign ? ` (#${payload.utmCampaign})` : ''}`,
    payload.message ? `ข้อความ: ${payload.message}` : null,
    ``,
    `เปิดดูใน Admin: ${adminUrl()}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function buildEmailHtml(payload: NotifyConsultationPayload): string {
  const requestTypes = payload.requestTypes.map((t) => REQUEST_TYPE_LABEL[t] ?? t).join(', ');
  const rows: [string, string][] = [
    ['ชื่อ', payload.name],
    ['ประเทศ', payload.country],
    [
      'ติดต่อ',
      `${CONTACT_CHANNEL_LABEL[payload.contactChannel] ?? payload.contactChannel} — ${payload.contactValue}`,
    ],
    ['สนใจ', requestTypes || '-'],
    ['ช่วงเวลาเดินทาง', TRAVEL_PERIOD_LABEL[payload.travelPeriod] ?? payload.travelPeriod],
    [
      'ที่มา',
      `${SOURCE_LABEL[payload.source] ?? payload.source}${payload.utmCampaign ? ` (#${payload.utmCampaign})` : ''}`,
    ],
  ];
  if (payload.message) rows.push(['ข้อความ', payload.message]);

  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px;color:#6b6a63;white-space:nowrap;vertical-align:top">${escapeHtml(
          label
        )}</td><td style="padding:6px 12px;color:#0b1e3d">${escapeHtml(value)}</td></tr>`
    )
    .join('');

  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#0b1e3d">🆕 คำขอปรึกษาใหม่ — ปรึกษา WOS ฟรี</h2>
      <table style="border-collapse:collapse;width:100%">${rowsHtml}</table>
      <p style="margin-top:20px">
        <a href="${adminUrl()}" style="background:#5b8c6e;color:#fff;padding:10px 20px;border-radius:24px;text-decoration:none;font-weight:600">
          เปิดดูใน Admin
        </a>
      </p>
    </div>
  `.trim();
}

function buildTelegramText(payload: NotifyConsultationPayload): string {
  const requestTypes = payload.requestTypes.map((t) => REQUEST_TYPE_LABEL[t] ?? t).join(', ');
  return [
    `🆕 ปรึกษา WOS ฟรี — คำขอใหม่`,
    `👤 ${payload.name} (${payload.country})`,
    `📞 ${CONTACT_CHANNEL_LABEL[payload.contactChannel] ?? payload.contactChannel} — ${payload.contactValue}`,
    `🩺 สนใจ: ${requestTypes || '-'}`,
    `🗓 ช่วงเวลาเดินทาง: ${TRAVEL_PERIOD_LABEL[payload.travelPeriod] ?? payload.travelPeriod}`,
    `🔗 ที่มา: ${SOURCE_LABEL[payload.source] ?? payload.source}${payload.utmCampaign ? ` (#${payload.utmCampaign})` : ''}`,
    payload.message ? `💬 ${payload.message}` : null,
    `👉 ${adminUrl()}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

async function sendTelegram(payload: NotifyConsultationPayload): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: buildTelegramText(payload) }),
  });

  if (!res.ok) {
    throw new Error(`Telegram sendMessage responded ${res.status}`);
  }
}

async function sendEmail(payload: NotifyConsultationPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONSULTATION_NOTIFY_EMAIL_TO;
  const from = process.env.CONSULTATION_NOTIFY_EMAIL_FROM;
  if (!apiKey || !to || !from) return;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: to.split(',').map((addr) => addr.trim()).filter(Boolean),
      subject: buildEmailSubject(payload),
      html: buildEmailHtml(payload),
      text: buildEmailText(payload),
    }),
  });

  if (!res.ok) {
    // Resend returns a JSON error body — surface it in the log so a
    // misconfigured domain/API key is diagnosable without needing to
    // reproduce the request by hand.
    const body = await res.text().catch(() => '');
    throw new Error(`Resend sendEmail responded ${res.status}: ${body}`);
  }
}

// Two channels (email + Telegram), shaped like notifyNewOrder()
// (Promise.allSettled over an array of channel senders) — adding a
// third channel later means appending one more entry here, not
// restructuring the function.
export async function notifyNewConsultation(payload: NotifyConsultationPayload): Promise<void> {
  const results = await Promise.allSettled([sendEmail(payload), sendTelegram(payload)]);
  for (const result of results) {
    if (result.status === 'rejected') {
      // Logged only — never surfaced to the customer, never retried.
      // The consultation_requests row is already saved regardless of
      // whether this notification goes out.
      console.error('consultation notification channel failed:', result.reason);
    }
  }
}
