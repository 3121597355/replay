'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANGUAGE_KEY, preferredLanguage, translate, type Language } from '@/lib/i18n';
import { usePathname } from 'next/navigation';

const Context = createContext({ language: 'zh' as Language, setLanguage: (_: Language) => {}, t: (source: string, ...values: (string | number)[]) => translate('zh', source, ...values) });

export default function LanguageProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Match the Chinese server HTML on the first render; apply preference after hydration.
  const [language, updateLanguage] = useState<Language>('zh');
  const apply = useCallback((next: Language) => {
    updateLanguage(next);
    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
    document.documentElement.dataset.language = next;
  }, []);
  const setLanguage = useCallback((next: Language) => {
    apply(next);
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* In-memory switching still works. */ }
  }, [apply]);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LANGUAGE_KEY); } catch {}
    apply(preferredLanguage(saved, navigator.languages || [navigator.language]));
    const sync = (event: StorageEvent) => {
      if (event.key === LANGUAGE_KEY) apply(preferredLanguage(event.newValue, navigator.languages || [navigator.language]));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [apply]);
  useEffect(() => {
    const title = ({ '/': '看剧练听力 · 跟读练口语', '/learn': '学习台', '/download': '下载', '/login': '登录剧说英语', '/signup': '免费创建账号', '/account/recover': '重设密码', '/account': '学习概览', '/account/settings': '账号设置', '/review': '收藏复习' } as Record<string, string>)[pathname];
    if (title) document.title = `${translate(language, title)} · ${translate(language, '剧说英语')}`;
  }, [language, pathname]);
  const value = useMemo(() => ({ language, setLanguage, t: (source: string, ...values: (string | number)[]) => translate(language, source, ...values) }), [language, setLanguage]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useLanguage = () => useContext(Context);

/** Localizes server-rendered page copy without making the whole page a client component. */
export function Text({ text, values = [] }: { text: string; values?: (string | number)[] }) {
  const { t } = useLanguage();
  return <>{t(text, ...values)}</>;
}

export function LanguageContent({ children, english }: { children: React.ReactNode; english: React.ReactNode }) {
  const { language } = useLanguage();
  return <>{language === 'en' ? english : children}</>;
}

export function LocalizedAnchor({ label, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { label: string }) {
  const { t } = useLanguage();
  return <a {...props} aria-label={t(label)} />;
}

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  return <button type="button" className="language-toggle" data-language-toggle
    aria-label={language === 'zh' ? 'Switch interface to English' : '切换界面为中文'}
    title={language === 'zh' ? 'Switch interface to English' : '切换界面为中文'}
    onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}>
    {language === 'zh' ? 'EN' : '中文'}
  </button>;
}
