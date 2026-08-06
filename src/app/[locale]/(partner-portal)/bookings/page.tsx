// src/app/(partner-portal)/bookings/page.tsx
import { requirePartnerAuth } from '@/lib/partner/auth';
import { BookingsList } from '@/components/partner/BookingsList';

export default async function BookingsPage() {
  const { user } = await requirePartnerAuth();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">การจอง</h1>
        <p className="text-sm text-slate-500">รายการจองทั้งหมดของ {user.organization.name}</p>
      </div>
      <BookingsList organizationId={user.organization_id} />
    </div>
  );
}
