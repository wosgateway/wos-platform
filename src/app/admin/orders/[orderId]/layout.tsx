import { AdminGate } from '@/components/admin/AdminGate';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}