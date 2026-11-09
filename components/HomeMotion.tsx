'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { watchMediaQuery } from '@/lib/browser';
import { setupScrollReveal } from '@/lib/scroll-reveal';

export default function HomeMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'system' | 'soft' | 'reduce'>('system');
  const [systemReduced, setSystemReduced] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('replay-home-motion');
      if (saved === 'soft' || saved === 'reduce') setMode(saved);
    } catch { /* The control also works without persistent storage. */ }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduced(media.matches);
    update();
    setMounted(true);
    return watchMediaQuery(media, update);
  }, []);
  useEffect(() => {
    if (root.current) return setupScrollReveal(root.current, mode);
  }, [mode]);
  const enabled = mode === 'soft' || (mode === 'system' && !systemReduced);
  const toggle = () => {
    const next = enabled ? 'reduce' : 'soft';
    setMode(next);
    try { localStorage.setItem('replay-home-motion', next); } catch { /* Optional preference. */ }
  };
  return (
    <div ref={root} data-page="home" data-home-motion={mode}>
      {children}
      {mounted && (
        <div className="mx-auto flex max-w-[1120px] justify-end px-4 pb-4 sm:px-6">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={enabled}
          aria-label={enabled ? '减少页面动效' : '开启页面动效'}
          title={enabled ? '点击减少动画' : '点击开启滚动入场动画'}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--page)] px-3 text-[12px] font-medium text-[var(--text-dim)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text)]"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 11 6 7l3 3 5-7M10 3h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          动效{enabled ? '已开启' : '已减少'}
        </button>
        </div>
      )}
    </div>
  );
}
