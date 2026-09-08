import { JourneyDetail } from '@/components/admin/JourneyDetail';

export default function AdminJourneyDetailPage({ params }: { params: { tripId: string } }) {
  return <JourneyDetail tripId={params.tripId} />;
}
