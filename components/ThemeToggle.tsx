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
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
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
      aria-label={isDark ? '切换到白天模式' : '切换到夜间模式'}
      title={isDark ? '切换到白天模式' : '切换到夜间模式'}
      aria-pressed={isDark}
      className="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] text-[var(--text-dim)] transition-[background-color,color,border-color,transform] duration-200 hover:-translate-y-px hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        className={`transition-transform duration-500 ${mounted ? '' : 'opacity-0'} ${isDark ? 'rotate-0' : 'rotate-180'}`}
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
    </button>
  );
}
