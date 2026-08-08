import { fetchPackagesByCategory } from '@/lib/data';
import { JourneyBookingForm } from '@/components/JourneyBookingForm';

// Multi-partner counterpart to /booking/[packageId]: the customer
// arrives here from the JourneyCartBar with several main packages
// already picked (stored client-side, see lib/journey/context.tsx),
// instead of a single `pkg` prop. Hotel/Transport add-on options are
// still fetched server-side exactly like the single-package booking
// page — same categories, same fallback behavior.
export default async function JourneyBookingPage() {
  const [hotelOptions, transportOptions] = await Promise.all([
    fetchPackagesByCategory(['Hotel']),
    fetchPackagesByCategory(['Transport']),
  ]);

  return (
    <main className="section-padding mx-auto max-w-2xl px-4">
      <JourneyBookingForm hotelOptions={hotelOptions} transportOptions={transportOptions} />
    </main>
  );
}
