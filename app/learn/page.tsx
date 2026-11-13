import type { Metadata } from 'next';
import { readAccount } from '@/lib/account-server';
import { safeReturnPath } from '@/lib/account-types';
import LearningStudio from '@/components/LearningStudio';
import AccountWorkspace from '@/components/account/AccountWorkspace';
import LearnWelcome from '@/components/account/LearnWelcome';
export const metadata: Metadata = { title: '学习台', robots: { index: false, follow: true } };
export const dynamic = 'force-dynamic';
export default async function LearnPage(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  const trial = searchParams.trial === '1';
  let state;
  try { state = await readAccount(); } catch { state = { user: null, mode: 'unavailable' as const }; }
  if (!trial && !state.user && state.mode !== 'local') {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) if (typeof value === 'string') query.set(key, value);
    const returnTo = safeReturnPath(`/learn${query.size ? `?${query}` : ''}`);
    return <LearnWelcome returnTo={returnTo} unavailable={state.mode === 'unavailable'} />;
  }
  return <AccountWorkspace owner={state.user?.id || (trial ? 'trial' : 'local')}><LearningStudio user={state.user} trial={trial} /></AccountWorkspace>;
}
