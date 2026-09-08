import { notFound } from 'next/navigation';
import { fetchPackageById, fetchPackagesByCategory, fetchTransportVehiclePricing } from '@/lib/data';
import { BookingForm } from '@/components/BookingForm';

// Replaces booking.html?package_id=<uuid> — same data, same tables,
// now server-fetched so the form never shows the old "loadingState"
// spinner for the package itself (only for the submit action).
export default async function BookingPage({
  params,
}: {
  params: { locale: string; packageId: string };
}) {
  let pkg;
  try {
    pkg = await fetchPackageById(params.packageId);
  } catch {
    notFound();
  }
  if (!pkg) notFound();

  // Hotel picker still lets the customer optionally pick a specific
  // partner package. Transport no longer offers a partner picker (see
  // migration 081) — just a starting-price-by-vehicle-type map.
  const [hotelOptions, transportVehiclePricing] = await Promise.all([
    fetchPackagesByCategory(['Hotel']),
    fetchTransportVehiclePricing(),
  ]);

  return (
    <main className="section-padding mx-auto max-w-2xl px-4">
      <BookingForm pkg={pkg} hotelOptions={hotelOptions} transportVehiclePricing={transportVehiclePricing} />
    </main>
  );
}
