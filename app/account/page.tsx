import { Text } from '@/components/LanguageProvider';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { accountService, AccountError, USER_COOKIE } from '@/lib/account-server';
import LearningHome from '@/components/account/LearningHome';
import AccountWorkspace from '@/components/account/AccountWorkspace';
export const metadata = { title: '个人中心', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function AccountPage() {
  const token = (await cookies()).get(USER_COOKIE)?.value;
  if (!token) redirect('/login?returnTo=%2Faccount');
  let summary;
  try { summary = await accountService('/summary', 'GET', undefined, token); }
  catch (error) { if (error instanceof AccountError && error.status === 401) redirect('/login?returnTo=%2Faccount'); return <div className="account-welcome"><h1><Text text="学习记录暂时连接不上" /></h1><p><Text text="本机的视频与收藏仍然保留，请稍后再打开。" /></p><a className="btn btn-primary" href="/account"><Text text="重新连接" /></a><a className="account-text-link" href="/learn"><Text text="先去学习台" /></a></div>; }
  return <AccountWorkspace owner={summary.user.id}><LearningHome initial={summary} /></AccountWorkspace>;
}
