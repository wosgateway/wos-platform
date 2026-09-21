import { requirePartnerAuth } from '@/lib/partner/auth';
import { createClient } from '@/lib/supabase/server';
import { RoutesManager } from '@/components/partner/RoutesManager';

export default async function RoutesPage() {
  const { user } = await requirePartnerAuth();

  let partnerCategory: string | null = null;

  if (user.branch?.partner_id) {
    const supabase = createClient();

    const { data: partnerRow } = await supabase
      .from('partners')
      .select('category')
      .eq('id', user.branch.partner_id)
      .single();

    partnerCategory = partnerRow?.category ?? null;
  }

  if (!user.branch?.partner_id) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">
            เสนทาง / Routes
          </h1>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          บญชของคณยงไมไดเชอมโยงกบ Partner กรณาตดตอทมงาน WOS
        </div>
      </div>
    );
  }

  if (partnerCategory !== 'Transport') {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">
            เสนทาง / Routes
          </h1>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
          เมนนสำหรบ Partner ประเภทขนสงเทานน
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          เสนทาง / Routes
        </h1>

        <p className="text-sm text-slate-500">
          จดการเสนทางใหบรการของ {user.branch.name} (
          {user.organization.name})
        </p>

        <p className="mt-1 text-xs text-slate-400">
          เสนทางเปนขอมลตงตนสำหรบการใหบรการขนสง ยงไมรวมราคาและการจดรถ
        </p>
      </div>

      <RoutesManager partnerId={user.branch.partner_id} />
    </div>
  );
}