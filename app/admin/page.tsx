import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, upstream } from '@/lib/admin-proxy';
import AdminDashboard from '@/components/admin/AdminDashboard';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Replay 管理后台', robots: { index: false, follow: false } };
export default async function AdminPage() {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!token) redirect('/admin/login');
  let valid = false;
  try { valid = (await upstream('settings', token)).ok; } catch {}
  if (!valid) redirect('/admin/login');
  return <AdminDashboard />;
}
