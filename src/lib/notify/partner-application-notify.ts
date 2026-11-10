export interface PartnerApplicationNotificationPayload {
  id: string;
  appUrl: string;
  language: string;
  companyName: string;
  businessType: string;
  primaryName: string;
  primaryEmail: string | null;
  primaryPhone: string;
  message: string | null;
}

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  clinic_hospital: 'คลินิก / โรงพยาบาล',
  hotel_resort: 'โรงแรม / รีสอร์ต',
  transport_agent: 'รถรับส่ง / เอเจนต์',
  investor: 'นักลงทุน',
};

function text(p: PartnerApplicationNotificationPayload): string {
  return [
    '🤝 WOS — Partner Application ใหม่',
    '',
    `🏢 บริษัท: ${p.companyName}`,
    `🏷 ประเภท: ${BUSINESS_TYPE_LABEL[p.businessType] ?? p.businessType}`,
    `👤 ผู้ติดต่อ: ${p.primaryName}`,
    `📞 โทร: ${p.primaryPhone}`,
    p.primaryEmail ? `✉️ อีเมล: ${p.primaryEmail}` : null,
    p.message ? `💬 ข้อความ: ${p.message}` : null,
    `🌐 ภาษา: ${p.language}`,
    `🆔 Application: ${p.id}`,
    `👉 ${p.appUrl}/admin?tab=partners`,
  ].filter((line): line is string => line !== null).join('\n');
}

async function sendTelegram(p: PartnerApplicationNotificationPayload): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.error(
      `[PARTNER_NOTIFY_FAILED] application=${p.id} reason=telegram_env_not_configured`
    );
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text(p) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram sendMessage responded ${res.status}: ${body}`);
  }
}

export async function notifyNewPartnerApplication(
  payload: PartnerApplicationNotificationPayload
): Promise<void> {
  try {
    await sendTelegram(payload);
    console.info(`[PARTNER_NOTIFY_SENT] application=${payload.id}`);
  } catch (error) {
    console.error(
      `[PARTNER_NOTIFY_FAILED] application=${payload.id}`,
      error instanceof Error ? error.message : error
    );
  }
}
