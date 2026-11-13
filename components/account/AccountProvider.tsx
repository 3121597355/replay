'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AccountState } from '@/lib/account-types';
type State = AccountState & { loading: boolean; refresh: () => Promise<void> };
const Context = createContext<State>({ user: null, mode: 'unavailable', loading: true, refresh: async () => {} });
export function signupSource() {
  try { return sessionStorage.getItem('replay.signup-source') || 'direct'; } catch { return 'direct'; }
}
export default function AccountProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<State, 'refresh'>>({ user: null, mode: 'unavailable', loading: true });
  const refresh = useCallback(async () => {
    try { const response = await fetch('/api/account/me', { cache: 'no-store', signal: AbortSignal.timeout(12000) }); if (!response.ok) throw new Error(); const data = await response.json(); setState({ ...data, loading: false }); }
    catch { setState(previous => ({ ...previous, loading: false, mode: 'unavailable' })); }
  }, []);
  useEffect(() => {
    try {
      if (!sessionStorage.getItem('replay.signup-source')) {
        const source = new URL(location.href).searchParams.get('utm_source');
        const referrer = document.referrer ? new URL(document.referrer).hostname : '';
        sessionStorage.setItem('replay.signup-source', source && /^[a-z0-9._-]{1,100}$/i.test(source) ? source : referrer && referrer !== location.hostname ? referrer : 'direct');
      }
    } catch {}
    void refresh();
    const update = () => void refresh();
    window.addEventListener('replay:account-updated', update);
    return () => window.removeEventListener('replay:account-updated', update);
  }, [refresh]);
  return <Context.Provider value={{ ...state, refresh }}>{children}</Context.Provider>;
}
export const useAccount = () => useContext(Context);
export function NavAccount() {
  const { user, loading, mode } = useAccount();
  if (mode === 'local') return <a href="/review" className="account-nav-link">收藏复习</a>;
  return <a href={user || loading ? '/account' : '/signup'} className="account-nav-link">{loading ? '账号' : user ? '我的学习' : '免费注册'}</a>;
}
