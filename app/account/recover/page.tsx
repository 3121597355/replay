import AccountForm from '@/components/account/AccountForm';
export const metadata = { title: '找回账号', robots: { index: false, follow: true } };
export default async function RecoverPage(props: { searchParams: Promise<{ returnTo?: string }> }) {
  const searchParams = await props.searchParams;
  return <AccountForm mode="recover" returnTo={searchParams.returnTo} />;
}
