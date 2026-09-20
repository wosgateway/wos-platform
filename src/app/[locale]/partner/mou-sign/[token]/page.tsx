// src/app/[locale]/partner/mou-sign/[token]/page.tsx
//
// Token-gated, no-login MOU signing page — same trust model as
// partner-trip/[token]/page.tsx (link IS the access control). All real
// work happens client-side against /api/mou-sign/[token]/* so the token
// is never embedded in server-rendered HTML/props where it could get
// cached or logged by an intermediary.

import { MouSignForm } from '@/components/partner/MouSignForm';

export default async function MouSignPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="mx-auto max-w-xl">
        <MouSignForm token={token} />
      </div>
    </div>
  );
}
