'use client';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
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
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), panelId = useId(), pathname = usePathname();
  useEffect(() => { setOpen(false); }, [pathname, user?.id, mode]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); root.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const person = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg>;
  if (!user && mode !== 'local') return <a href={loading ? '/account' : '/login?returnTo=%2Faccount'} className="account-nav-link account-menu-trigger" aria-label={loading ? '个人中心' : '登录或注册'} title={loading ? '个人中心' : '登录或注册'}><span className="account-avatar" aria-hidden="true">{person}</span><span className="account-menu-label">{loading ? '个人中心' : '登录 / 注册'}</span></a>;
  return <div className="account-menu" ref={root} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className="account-nav-link account-menu-trigger" aria-label="个人中心" title={user ? `${user.username} · 个人中心` : '本机学习'} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(value => !value)}>
      <span className="account-avatar" aria-hidden="true">{user ? [...user.username.trim()][0]?.toUpperCase() || person : person}</span><span className="account-menu-label">个人中心</span>
      <svg className="account-menu-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div className="account-user-panel" id={panelId}>
      <div className="account-user-identity"><strong>{user?.username || '本机学习'}</strong><span>{user?.email || (user ? '你的学习与账号' : '学习记录保存在浏览器')}</span></div>
      <nav aria-label="个人中心导航" onClick={() => setOpen(false)}>
        {user ? <a href="/account">学习概览<span>时长、打卡与学习进度</span></a> : <a href="/learn">学习台<span>继续学习本机素材</span></a>}
        <a href="/review">收藏复习<span>复习保存的词和原句</span></a>
        {user && <a href="/account#account-settings">账号设置<span>邮箱、登录与账号安全</span></a>}
      </nav>
    </div>}
  </div>;
}
