import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

// URL สำหรับหน้า Quotation (เปลี่ยนเป็น domain จริงตอน deploy)
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  // Used only as a place for Supabase to write a refreshed access/refresh
  // token pair into, via requireAdmin's setAll(). Never returned directly.
  // Same pattern as every other admin route — see
  // src/lib/admin/require-admin.ts for the rationale.
  const cookieCarrier = new NextResponse();

  // 1. ตรวจสอบสิทธิ์ Admin
  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      cookieCarrier
    );
  }

  // 2. รับข้อมูลจาก request
  const body = await request.json().catch(() => null);
  const orderId = body?.orderId;
  const phoneNumber = body?.phoneNumber;
  const channel = body?.channel;

  if (!orderId || !phoneNumber) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'Missing orderId or phoneNumber' },
        { status: 400 }
      ),
      cookieCarrier
    );
  }

  // 3. ดึงข้อมูล order
  // SECURITY: also select payment_access_token (migration 021) so the
  // link we send carries the ?token= that /api/quote/[orderNumber]
  // and its /confirm sibling now require — order_number alone is a
  // predictable sequence, not a secret.
  const supabase = createClient();
  const { data: order, error } = await supabase
    .from('orders')
    .select('order_number, total_amount, total_deposit_required, payment_access_token')
    .eq('id', orderId)
    .single();

  if (error || !order) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Order not found' }, { status: 404 }),
      cookieCarrier
    );
  }

  // 3b. GUARD: block sending a quote while this order still has any
  // order_items row with needs_assignment = true ("let team decide"
  // hotel/transport, migrations 013/014/036/037 — price/deposit_required
  // are still NULL on that row and NOT reflected in order.total_amount/
  // total_deposit_required, since sync_order_totals() SUMs and SUM()
  // skips NULLs). Sending a quote in this state shows the customer a
  // total that silently excludes those items — see the audit that
  // flagged this (admin_assign_order_item() end-to-end review). Fail
  // closed: a lookup error here must also block sending, not fall
  // through as if there were no pending items.
  const { count: pendingCount, error: pendingErr } = await supabase
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .eq('needs_assignment', true);

  if (pendingErr) {
    console.error('send-quotation: pending-assignment check failed:', pendingErr);
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'ตรวจสอบสถานะรายการไม่สำเร็จ กรุณาลองใหม่' },
        { status: 500 }
      ),
      cookieCarrier
    );
  }

  if ((pendingCount ?? 0) > 0) {
    return withRefreshedCookies(
      NextResponse.json(
        {
          error: `ยังส่งใบเสนอราคาไม่ได้: มี ${pendingCount} รายการที่ยังรอทีมจัด partner/แพ็กเกจอยู่ กรุณา assign ให้ครบก่อน (ยอดรวมปัจจุบันยังไม่รวมรายการเหล่านี้)`,
          pendingCount,
        },
        { status: 409 }
      ),
      cookieCarrier
    );
  }

  // 4. สร้างลิงก์ใบเสนอราคา
  const quoteUrl = `${APP_URL}/th/quote/${order.order_number}?token=${encodeURIComponent(
    order.payment_access_token
  )}`;

  // 5. สร้างข้อความ
  const message = `
🏥 Wellness One Stop
📋 ใบเสนอราคา #${order.order_number}

ยอดรวม: ${order.total_amount.toLocaleString()} บาท
มัดจำ 15%: ${order.total_deposit_required.toLocaleString()} บาท

👉 ดูรายละเอียด: ${quoteUrl}

⏰ กรุณาชำระมัดจำภายใน 24 ชั่วโมง
  `;

  // 6. ส่งตามช่องทางที่เลือก
  let success = false;
  let errorMessage = '';

  if (channel === 'whatsapp') {
    // TODO: ใช้ WhatsApp Business API หรือ Twilio
    try {
      success = true;
    } catch (e) {
      errorMessage = String(e);
    }
  } else if (channel === 'sms') {
    // TODO: ใช้ SMS Gateway
    try {
      success = true;
    } catch (e) {
      errorMessage = String(e);
    }
  } else {
    // channel === 'copy' — คัดลอกลิงก์
    success = true;
  }

  // 7. บันทึกประวัติการส่ง (optional)
  // TODO: สร้างตาราง quotation_logs

  return withRefreshedCookies(
    NextResponse.json({
      success,
      quoteUrl,
      messageText: message,
      status: success ? 'ส่งสำเร็จ' : errorMessage,
    }),
    cookieCarrier
  );
}
