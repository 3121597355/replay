import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, upstream } from '@/lib/admin-proxy';
import AdminDashboard from '@/components/admin/AdminDashboard';
export const dynamic = 'force-dynamic';
export const metadata = { title: '管理后台', robots: { index: false, follow: false } };
export default async function AdminPage() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || token.length > 1024) redirect('/admin/login');
  let valid = false;
  let initialSettings, initialReport;
  try {
    const end = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
    const start = new Date(Date.parse(end) - 29 * 86400000).toISOString().slice(0, 10);
    const [config, report] = await Promise.all([upstream('settings', token), upstream('report', token, 'GET', undefined, `?start=${start}&end=${end}`)]);
    valid = config.ok;
    if (valid) initialSettings = await config.json();
    if (report.ok) initialReport = await report.json();
  } catch {}
  if (!valid) redirect('/admin/login');
  return <AdminDashboard initialSettings={initialSettings} initialReport={initialReport} />;
}
