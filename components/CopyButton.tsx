'use client';

import { useEffect, useRef, useState } from 'react';

export default function CopyButton({
  text,
  label = '复制',
  className = '',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
        done
          ? 'border-[#bed9c6] bg-[#edf5ef] text-[#2f6b4f]'
          : 'border-[#dbe1da] bg-white text-[#68736c] hover:border-[#b8c8bc] hover:text-[#2f6b4f]'
      } ${className}`}
    >
      {done ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m5 13 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      )}
      {done ? '已复制' : label}
    </button>
  );
}
