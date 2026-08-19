// src/components/partner/BillingDashboard.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Subscription {
  id: string;
  tier: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'expired' | 'cancelled' | 'grace_period';
  started_at: string;
  expires_at: string | null;
  cancelled_at: string | null;
  features: {
    max_packages?: number;
    max_branches?: number;
    max_users?: number;
    custom_domain?: boolean;
    analytics?: boolean;
    api_access?: boolean;
  } | null;
}

interface Organization {
  id: string;
  name: string;
  tier: string;
  subscription_status: string;
  trial_ends_at: string | null;
  subscription_ends_at: string | null;
}

const TIER_FEATURES = {
  free: {
    label: 'ฟรี',
    price: '0 บาท',
    features: [
      'โปรแกรมได้สูงสุด 5 รายการ',
      'สาขาได้สูงสุด 1 แห่ง',
      'ผู้ใช้ได้สูงสุด 2 คน',
      'การจองไม่จำกัด',
      'รองรับภาษาไทย-ลาว-อังกฤษ',
    ],
    limitations: ['ไม่มี Custom Domain', 'ไม่มี Analytics', 'ไม่มี API'],
  },
  pro: {
    label: 'Pro',
    price: '1,999 บาท/เดือน',
    features: [
      'โปรแกรมไม่จำกัด',
      'สาขาได้สูงสุด 5 แห่ง',
      'ผู้ใช้ได้สูงสุด 10 คน',
      'การจองไม่จำกัด',
      'รองรับภาษาไทย-ลาว-อังกฤษ',
      'Custom Domain',
      'Analytics Dashboard',
    ],
    limitations: ['ไม่มี API Access'],
  },
  enterprise: {
    label: 'Enterprise',
    price: 'ติดต่อทีมขาย',
    features: [
      'โปรแกรมไม่จำกัด',
      'สาขาไม่จำกัด',
      'ผู้ใช้ไม่จำกัด',
      'การจองไม่จำกัด',
      'รองรับทุกภาษา',
      'Custom Domain',
      'Analytics Dashboard',
      'API Access',
      'Priority Support',
      'SLA Guarantee',
    ],
    limitations: [],
  },
};

// ✅ แยกออกมาเป็น constant กลาง แทนการเขียน ternary ซ้ำในหลายจุด
const FEATURES_BY_TIER = {
  pro: {
    max_packages: 999,
    max_branches: 5,
    max_users: 10,
    api_access: false,
  },
  enterprise: {
    max_packages: 9999,
    max_branches: 999,
    max_users: 999,
    api_access: true,
  },
} as const;

export function BillingDashboard({ organizationId }: { organizationId: string }) {
  const supabase = createClient();
  const [org, setOrg] = useState<Organization | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  async function loadBilling() {
    setLoading(true);
    setError(null);

    const [orgRes, subRes] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', organizationId).single(),
      supabase
        .from('subscriptions')
        .select('*')
        .eq('organization_id', organizationId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    setLoading(false);

    if (orgRes.error) {
      setError('โหลดข้อมูลไม่สำเร็จ: ' + orgRes.error.message);
      return;
    }

    setOrg(orgRes.data);
    setSubscription(subRes.data as Subscription | null);
  }

  useEffect(() => {
    loadBilling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpgrade(tier: 'pro' | 'enterprise') {
    if (tier === 'enterprise') {
      window.location.href = 'mailto:hello@wos.asia?subject=สนใจแพ็กเกจ Enterprise';
      return;
    }

    if (!confirm(`ยืนยันการอัปเกรดเป็นแพ็กเกจ ${TIER_FEATURES[tier].label}?`)) return;

    setUpgrading(tier);

    const features = FEATURES_BY_TIER[tier];

    // สร้าง subscription ใหม่
    const payload = {
      organization_id: organizationId,
      tier: tier,
      status: 'active',
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      features: {
        ...features,
        custom_domain: true,
        analytics: true,
      },
    };

    const { error: subError } = await supabase.from('subscriptions').insert(payload);

    if (subError) {
      alert('อัปเกรดไม่สำเร็จ: ' + subError.message);
      setUpgrading(null);
      return;
    }

    // อัปเดต organization tier
    const { error: orgError } = await supabase
      .from('organizations')
      .update({ tier, subscription_status: 'active' })
      .eq('id', organizationId);

    setUpgrading(null);

    if (orgError) {
      alert('อัปเกรดไม่สำเร็จ: ' + orgError.message);
      return;
    }

    loadBilling();
    alert('✅ อัปเกรดสำเร็จ!');
  }

  const currentTier = org?.tier || 'free';
  const currentFeatures = TIER_FEATURES[currentTier as keyof typeof TIER_FEATURES];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-600">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">แผนปัจจุบัน</h2>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-2xl font-bold text-primary-dark">
                {currentFeatures.label}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                org?.subscription_status === 'active'
                  ? 'bg-emerald-100 text-emerald-600'
                  : 'bg-amber-100 text-amber-600'
              }`}>
                {org?.subscription_status === 'active' ? '✅ ใช้งานอยู่' : '⏳ รอดำเนินการ'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">
              {currentTier === 'free' && org?.trial_ends_at
                ? `ทดลองใช้ถึง ${new Date(org.trial_ends_at).toLocaleDateString('th-TH')}`
                : org?.subscription_ends_at
                ? `หมดอายุ ${new Date(org.subscription_ends_at).toLocaleDateString('th-TH')}`
                : 'ไม่มีกำหนด'}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-slate-800">ˆž</p>
            <p className="text-xs text-slate-400">การจอง</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-slate-800">
              {subscription?.features?.max_packages || 5}
            </p>
            <p className="text-xs text-slate-400">โปรแกรม</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-slate-800">
              {subscription?.features?.max_branches || 1}
            </p>
            <p className="text-xs text-slate-400">สาขา</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-slate-800">
              {subscription?.features?.max_users || 2}
            </p>
            <p className="text-xs text-slate-400">ผู้ใช้</p>
          </div>
        </div>
      </div>

      {/* Upgrade Options */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-4">📈 อัปเกรดแผน</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['free', 'pro', 'enterprise'] as const).map((tier) => {
            const features = TIER_FEATURES[tier];
            const isCurrent = tier === currentTier;
            const isDisabled = isCurrent || upgrading !== null;

            return (
              <div
                key={tier}
                className={`bg-white rounded-xl border p-5 ${
                  isCurrent ? 'border-primary ring-2 ring-primary/20' : 'border-slate-100'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-lg font-bold text-slate-900">{features.label}</h4>
                  {isCurrent && (
                    <span className="text-xs font-medium text-primary-dark bg-primary-light px-2 py-0.5 rounded-full">
                      ปัจจุบัน
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-primary-dark mb-4">{features.price}</p>

                <ul className="space-y-1.5 mb-4">
                  {features.features.map((f, i) => (
                    <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                      <span className="text-emerald-500">✓</span>
                      {f}
                    </li>
                  ))}
                  {features.limitations.map((l, i) => (
                    <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                      <span className="text-slate-300">✗</span>
                      {l}
                    </li>
                  ))}
                </ul>

                {tier === 'free' ? (
                  <button
                    disabled
                    className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-400 cursor-not-allowed"
                  >
                    แผนเริ่มต้น
                  </button>
                ) : (
                  <button
                    onClick={() => handleUpgrade(tier)}
                    disabled={isDisabled}
                    className={`w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      isCurrent
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : 'bg-primary text-white hover:bg-primary-dark'
                    }`}
                  >
                    {upgrading === tier
                      ? '⏳ กำลังดำเนินการ...'
                      : isCurrent
                      ? 'ใช้งานอยู่'
                      : tier === 'enterprise'
                      ? '📞 ติดต่อทีมขาย'
                      : `อัปเกรดเป็น ${features.label}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Subscription History */}
      {subscription && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-card p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">📜 ประวัติการสมัคร</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">เริ่มใช้งาน</span>
              <span className="text-slate-800">
                {new Date(subscription.started_at).toLocaleDateString('th-TH')}
              </span>
            </div>
            {subscription.expires_at && (
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">หมดอายุ</span>
                <span className="text-slate-800">
                  {new Date(subscription.expires_at).toLocaleDateString('th-TH')}
                </span>
              </div>
            )}
            {subscription.cancelled_at && (
              <div className="flex justify-between">
                <span className="text-slate-500">ยกเลิกเมื่อ</span>
                <span className="text-red-500">
                  {new Date(subscription.cancelled_at).toLocaleDateString('th-TH')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
