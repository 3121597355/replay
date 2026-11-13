import type { Metadata } from 'next';
import AccountForm from '@/components/account/AccountForm';
export const metadata: Metadata = { title: '免费注册', robots: { index: false, follow: true } };
export default async function SignupPage(props: { searchParams: Promise<{ returnTo?: string }> }) {
  const searchParams = await props.searchParams;
  return <AccountForm mode="signup" returnTo={searchParams.returnTo} />;
}
