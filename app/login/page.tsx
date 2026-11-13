import type { Metadata } from 'next';
import AccountForm from '@/components/account/AccountForm';
export const metadata: Metadata = { title: '登录', robots: { index: false, follow: true } };
export default async function LoginPage(props: { searchParams: Promise<{ returnTo?: string }> }) {
  const searchParams = await props.searchParams;
  return <AccountForm mode="login" returnTo={searchParams.returnTo} />;
}
