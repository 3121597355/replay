'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';

const links = [
  { href: '/', label: '首页' },
  { href: '/#catalog', label: '片单' },
  { href: '/learn', label: '学习台' },
];

export default function Nav() {
  const pathname = usePathname();
  const isLearn = pathname.startsWith('/learn');

  return (
    <header
      className={`sticky top-0 z-50 border-b ${
        isLearn
          ? 'border-[rgb(var(--fg-rgb)/0.08)] bg-[var(--learn-bar)] backdrop-blur-md'
          : 'border-[var(--line)] bg-[rgb(var(--bg-rgb)/0.95)] backdrop-blur-md'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1120px] items-center px-4 sm:px-6">
        <Link href="/" className="mr-5 flex shrink-0 items-center gap-2 rounded-md" aria-label="Replay 首页">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--accent)]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 4.2A1.2 1.2 0 0 1 4.2 3h5.6A3.2 3.2 0 0 1 13 6.2v5.6A1.2 1.2 0 0 1 11.8 13H6.2A3.2 3.2 0 0 1 3 9.8V4.2Z" stroke="white" strokeWidth="1.4" />
              <path d="m6.6 6 3.4 2-3.4 2V6Z" fill="white" />
            </svg>
          </span>
          <span className={`text-[17px] font-semibold tracking-[-0.02em] text-[var(--text)]`}>
            Replay
          </span>
        </Link>

        <nav className="flex h-16 items-stretch gap-0.5" aria-label="主导航">
          {links.map((link) => {
            const active = link.href === '/'
              ? pathname === '/'
              : link.href === '/#catalog'
                ? pathname.startsWith('/movie')
                : pathname.startsWith('/learn');
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative flex shrink-0 items-center whitespace-nowrap px-2.5 text-[14px] transition-colors sm:px-3.5 ${
                  isLearn
                    ? active ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                    : active ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                {link.label}
                {active && (
                  <span className={`absolute inset-x-2.5 bottom-0 h-0.5 sm:inset-x-3.5 ${isLearn ? 'bg-[#e0a94a]' : 'bg-[#fd8c73]'}`} />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {isLearn ? (
            <span className="hidden text-[12px] text-[var(--text-faint)] sm:block">本地运行</span>
          ) : (
            <Link href="/learn" className="btn btn-primary hidden !h-8 !px-3 !py-0 !text-[13px] sm:inline-flex">
              开始学习
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
