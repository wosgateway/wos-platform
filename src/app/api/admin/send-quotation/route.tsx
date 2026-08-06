import { requireAdmin } from '@/lib/admin/require-admin';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

// URL สำหรับหน้า Quotation (เปลี่ยนเป็น domain จริงตอน deploy)
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  // 1. ตรวจสอบสิทธิ์ Admin
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. รับข้อมูลจาก request
  const body = await request.json();
  const { orderId, phoneNumber, channel } = body;

  if (!orderId || !phoneNumber) {
    return NextResponse.json(
      { error: 'Missing orderId or phoneNumber' },
      { status: 400 }
    );
  }

  // 3. ดึงข้อมูล order
  const supabase = createClient();
  const { data: order, error } = await supabase
    .from('orders')
    .select('order_number, total_amount, total_deposit_required')
    .eq('id', orderId)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // 4. สร้างลิงก์ใบเสนอราคา
  const quoteUrl = `${APP_URL}/th/quote/${order.order_number}`;

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

  return NextResponse.json({
    success,
    quoteUrl,
    messageText: message,
    status: success ? 'ส่งสำเร็จ' : errorMessage,
  });
}