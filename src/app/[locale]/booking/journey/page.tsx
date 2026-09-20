import { fetchPackagesByCategory, fetchTransportVehiclePricing } from '@/lib/data';
import { JourneyBookingForm } from '@/components/JourneyBookingForm';

// Multi-partner counterpart to /booking/[packageId]: the customer
// arrives here from the JourneyCartBar with several main packages
// already picked (stored client-side, see lib/journey/context.tsx),
// instead of a single `pkg` prop. Hotel add-on options are still
// fetched server-side exactly like the single-package booking page.
// Transport no longer offers a partner picker (see migration 081) —
// just a starting-price-by-vehicle-type map.
export default async function JourneyBookingPage() {
  const [hotelOptions, transportVehiclePricing] = await Promise.all([
    fetchPackagesByCategory(['Hotel']),
    fetchTransportVehiclePricing(),
  ]);

  return (
    <main className="section-padding mx-auto max-w-2xl px-4">
      <JourneyBookingForm hotelOptions={hotelOptions} transportVehiclePricing={transportVehiclePricing} />
    </main>
  );
}
