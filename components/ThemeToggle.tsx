'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    setTheme(current);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('replay-theme', next);
    } catch {
      /* 隐私模式下忽略 */
    }
  };

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
      title={isDark ? '当前深色，点击切换浅色' : '当前浅色，点击切换深色'}
      aria-pressed={isDark}
      className="inline-flex h-11 shrink-0 touch-manipulation items-center justify-center gap-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-2 text-[var(--text)] transition-colors duration-200 hover:bg-[var(--surface-3)] active:bg-[var(--surface-3)] sm:h-9 sm:px-2.5"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        className={`shrink-0 transition-transform duration-300 ${isDark ? 'rotate-0' : 'rotate-180'}`}
        aria-hidden="true"
      >
        {isDark ? (
          <path
            d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
      <span className="whitespace-nowrap text-[12px] font-semibold" aria-hidden="true">{isDark ? '深色' : '浅色'}</span>
      <span className="sr-only" role="status">{mounted ? `当前为${isDark ? '深色' : '浅色'}模式` : ''}</span>
    </button>
  );
}
