'use client';

import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// Type definitions
interface Order {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  total_deposit_required: number;
  total_deposit_paid: number;
  total_balance_remaining: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customers: {
    id: string;
    full_name: string;
    phone: string;
    line_id: string | null;
    email: string | null;
    country: string | null;
  } | null;
}

interface OrderItem {
  id: string;
  service_type: string;
  price: number | null;
  deposit_required: number | null;
  deposit_paid: number;
  balance_remaining: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: string;
  needs_assignment: boolean;
  packages: {
    id: string;
    title: string;
  } | null;
  partners: {
    id: string;
    name: string;
  } | null;
}

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  status: string;
  created_at: string;
  verified_at: string | null;
}

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [quoteLink, setQuoteLink] = useState('');

  const statusLabels: Record<string, string> = {
    draft: 'ร่าง',
    pending_deposit: 'รอชำระมัดจำ',
    deposit_paid: 'ชำระมัดจำแล้ว',
    confirmed: 'ยืนยันแล้ว',
    checked_in: 'เข้ารับบริการ',
    completed: 'เสร็จสิ้น',
    cancelled: 'ยกเลิก',
    refunded: 'คืนเงินแล้ว',
  };

  const serviceTypeLabels: Record<string, string> = {
    clinic: 'คลินิก/แพทย์',
    hotel: 'โรงแรม',
    transport: 'ขนส่ง',
    wellness: 'เวลเนส',
    insurance: 'ประกันภัย',
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-200 text-gray-700',
    pending_deposit: 'bg-yellow-100 text-yellow-800',
    deposit_paid: 'bg-blue-100 text-blue-800',
    confirmed: 'bg-green-100 text-green-800',
    checked_in: 'bg-purple-100 text-purple-800',
    completed: 'bg-emerald-100 text-emerald-800',
    cancelled: 'bg-red-100 text-red-800',
    refunded: 'bg-rose-100 text-rose-800',
  };

  useEffect(() => {
    async function loadOrder() {
      if (!orderId) return;

      setLoading(true);
      try {
        const supabase = createClient();

        // Fetch order
        const { data: orderData, error: orderError } = await supabase
          .from('orders')
          .select(`
            id,
            order_number,
            status,
            total_amount,
            total_deposit_required,
            total_deposit_paid,
            total_balance_remaining,
            notes,
            created_at,
            updated_at,
            customers:patient_id (
              id,
              full_name,
              phone,
              line_id,
              email,
              country
            )
          `)
          .eq('id', orderId)
          .single();

        if (orderError) throw orderError;
        setOrder(orderData);

        // Fetch items
        const { data: itemsData } = await supabase
          .from('order_items')
          .select(`
            id,
            service_type,
            price,
            deposit_required,
            deposit_paid,
            balance_remaining,
            scheduled_date,
            scheduled_time,
            status,
            needs_assignment,
            packages:package_id (
              id,
              title
            ),
            partners:partner_id (
              id,
              name
            )
          `)
          .eq('order_id', orderId);

        setItems(itemsData || []);

        // Fetch payments
        const { data: paymentsData } = await supabase
          .from('payments')
          .select('*')
          .eq('order_id', orderId);

        setPayments(paymentsData || []);
      } catch (e) {
        console.error('Error loading order:', e);
        setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
      } finally {
        setLoading(false);
      }
    }

    loadOrder();
  }, [orderId]);

  const handleSendQuotation = async () => {
    if (!order) return;

    setSending(true);
    setSent(false);

    try {
      const res = await fetch('/api/admin/send-quotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          phoneNumber: phone,
          channel,
        }),
      });

      const result = await res.json();

      if (result.success) {
        setSent(true);
        setQuoteLink(result.quoteUrl);

        if (channel === 'copy') {
          await navigator.clipboard.writeText(result.quoteUrl);
          alert('คัดลอกลิงก์เรียบร้อยแล้ว!');
        }

        setTimeout(() => {
          setShowModal(false);
          setSent(false);
          setQuoteLink('');
        }, 2000);
      } else {
        alert('ส่งไม่สำเร็จ: ' + result.message);
      }
    } catch (e) {
      console.error('Error sending quotation:', e);
      alert('เกิดข้อผิดพลาดในการส่ง');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        กำลังโหลด...
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="p-8 text-center text-red-600">
        {error || 'ไม่พบคำสั่งซื้อนี้'}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <Link href="/admin" className="text-blue-600 text-sm hover:underline">
            ← กลับ
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">
            ใบเสนอราคา #{order.order_number}
          </h1>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700"
          >
            📧 ส่งใบเสนอราคา
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"
          >
            🖨️ พิมพ์
          </button>
        </div>
      </div>

      {/* Status Badge */}
      <div className="mb-6">
        <span className={`px-4 py-2 rounded-full text-sm font-medium ${statusColors[order.status] || 'bg-gray-100 text-gray-700'}`}>
          สถานะ: {statusLabels[order.status] || order.status}
        </span>
      </div>

      {/* Quotation Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        {/* Header: Company Info */}
        <div className="flex justify-between border-b border-slate-200 pb-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Wellness One Stop</h2>
            <p className="text-sm text-slate-500">ใบเสนอราคา / Quotation</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">เลขที่: {order.order_number}</p>
            <p className="text-sm text-slate-500">
              วันที่: {new Date(order.created_at).toLocaleDateString('th-TH')}
            </p>
          </div>
        </div>

        {/* Customer Info */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-sm text-slate-500">ชื่อผู้ติดต่อ</p>
            <p className="font-medium text-slate-800">{order.customers?.full_name || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">เบอร์โทร</p>
            <p className="font-medium text-slate-800">{order.customers?.phone || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">LINE ID</p>
            <p className="font-medium text-slate-800">{order.customers?.line_id || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">ประเทศ</p>
            <p className="font-medium text-slate-800">{order.customers?.country || '-'}</p>
          </div>
        </div>

        {/* Items Table */}
        <table className="w-full text-sm mb-4">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left text-slate-600">รายการ</th>
              <th className="px-4 py-2 text-left text-slate-600">บริการ</th>
              <th className="px-4 py-2 text-left text-slate-600">ผู้ให้บริการ</th>
              <th className="px-4 py-2 text-right text-slate-600">ราคา</th>
              <th className="px-4 py-2 text-right text-slate-600">มัดจำ 15%</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-3">
                  {item.needs_assignment ? (
                    <span className="text-yellow-600">⏳ รอเลือกแพ็คเกจ</span>
                  ) : (
                    item.packages?.title || '-'
                  )}
                </td>
                <td className="px-4 py-3">
                  {serviceTypeLabels[item.service_type] || item.service_type}
                </td>
                <td className="px-4 py-3">
                  {item.needs_assignment ? '-' : item.partners?.name || '-'}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {item.price ? formatTHB(item.price) : '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  {item.deposit_required ? formatTHB(item.deposit_required) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200">
            <tr>
              <td colSpan={3} className="px-4 py-3 text-right font-bold text-slate-800">
                รวม
              </td>
              <td className="px-4 py-3 text-right font-bold text-slate-800">
                {formatTHB(order.total_amount)}
              </td>
              <td className="px-4 py-3 text-right font-bold text-blue-600">
                {formatTHB(order.total_deposit_required)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Notes */}
        {order.notes && (
          <div className="border-t border-slate-200 pt-4 mt-4">
            <p className="text-sm text-slate-500">หมายเหตุ:</p>
            <p className="text-sm text-slate-700">{order.notes}</p>
          </div>
        )}

        {/* Payment Instructions */}
        <div className="bg-blue-50 rounded-xl p-4 mt-4">
          <h4 className="font-medium text-blue-800 mb-2">💳 วิธีการชำระเงิน</h4>
          <p className="text-sm text-blue-700">
            กรุณาชำระเงินมัดจำ 15% ภายใน 24 ชั่วโมง เพื่อยืนยันการจอง
          </p>
          <div className="mt-2 text-sm text-blue-700">
            <p>ธนาคาร: XXX</p>
            <p>เลขที่บัญชี: XXXX-XXXX-XXXX</p>
            <p>ชื่อบัญชี: Wellness One Stop</p>
          </div>
        </div>
      </div>

      {/* Payment History */}
      {payments.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="font-medium text-slate-800 mb-3">💰 ประวัติการชำระเงิน</h3>
          {payments.map((payment) => (
            <div key={payment.id} className="flex justify-between items-center border-b border-slate-100 py-2">
              <div>
                <p className="font-medium text-slate-800">{formatTHB(payment.amount)}</p>
                <p className="text-xs text-slate-400">
                  {new Date(payment.created_at).toLocaleString('th-TH')}
                </p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                payment.status === 'verified' ? 'bg-green-100 text-green-800' :
                payment.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                'bg-gray-100 text-gray-700'
              }`}>
                {payment.status === 'verified' ? '✅ ตรวจสอบแล้ว' :
                 payment.status === 'pending' ? '⏳ รอตรวจสอบ' :
                 payment.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Send Quotation Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-slate-900 mb-4">ส่งใบเสนอราคา</h3>
            <p className="text-sm text-slate-500 mb-4">
              ส่งใบเสนอราคา #{order.order_number} ให้ลูกค้า
            </p>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700">เบอร์โทรศัพท์</label>
                <input
                  type="tel"
                  className="w-full px-4 py-2 border border-slate-300 rounded-xl mt-1"
                  placeholder="081-234-5678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">ช่องทาง</label>
                <select
                  className="w-full px-4 py-2 border border-slate-300 rounded-xl mt-1"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  <option value="whatsapp">📱 WhatsApp</option>
                  <option value="sms">📨 SMS</option>
                  <option value="copy">📋 คัดลอกลิงก์</option>
                </select>
              </div>

              {sent && quoteLink && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700">
                  ✅ ส่งสำเร็จ! ลิงก์: <span className="font-mono text-xs break-all">{quoteLink}</span>
                </div>
              )}

              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => {
                    setShowModal(false);
                    setSent(false);
                    setQuoteLink('');
                  }}
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleSendQuotation}
                  disabled={sending || !phone.trim()}
                  className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? 'กำลังส่ง...' : sent ? '✅ ส่งแล้ว' : 'ส่ง'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}