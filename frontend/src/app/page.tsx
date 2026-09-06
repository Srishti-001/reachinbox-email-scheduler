import { redirect } from 'next/navigation';

// Root "/" → redirect to the scheduled emails dashboard
export default function RootPage() {
  redirect('/dashboard/scheduled');
}
