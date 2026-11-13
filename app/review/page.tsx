import { redirect } from 'next/navigation';
import { readAccount } from '@/lib/account-server';
import AccountWorkspace from '@/components/account/AccountWorkspace';
import ReviewCards from '@/components/account/ReviewCards';
export const metadata = { title: '收藏复习', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function ReviewPage() {
  let state;
  try { state = await readAccount(); } catch { return <div className="account-welcome"><h1>连接暂时不稳定</h1><a href="/review" className="btn btn-primary">重新打开复习</a></div>; }
  if (!state.user && state.mode !== 'local') redirect('/login?returnTo=%2Freview');
  return <AccountWorkspace owner={state.user?.id || 'local'}><ReviewCards /></AccountWorkspace>;
}
