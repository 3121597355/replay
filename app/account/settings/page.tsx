import { redirect } from 'next/navigation';
import { readAccount } from '@/lib/account-server';
import AccountWorkspace from '@/components/account/AccountWorkspace';
import AccountSettings from '@/components/account/AccountSettings';

export const metadata = { title: '账号设置', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  let state;
  try { state = await readAccount(); }
  catch {
    return <div className="account-welcome"><h1>账号暂时连接不上</h1><p>请稍后重试，你的本机学习内容仍然保留。</p><a className="btn btn-primary" href="/account/settings">重新连接</a><a className="account-text-link" href="/account">返回学习概览</a></div>;
  }
  if (!state.user) redirect('/login?returnTo=%2Faccount%2Fsettings');
  return <AccountWorkspace owner={state.user.id}><AccountSettings initialUser={state.user} /></AccountWorkspace>;
}
