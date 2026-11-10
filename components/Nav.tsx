'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import ReplayMark from './ReplayMark';

const links = [
  { href: '/', label: '首页' },
  { href: '/#catalog', label: '片单' },
  { href: '/learn', label: '学习台' },
  { href: '/download', label: '下载' },
];

export default function Nav() {
  const pathname = usePathname();
  const isLearn = pathname.startsWith('/learn');
  const isDownload = pathname === '/download';
  const HomeLink = isDownload ? 'a' : Link;

  return (
    <header
      className={`sticky top-0 z-50 shrink-0 border-b ${
        isLearn
          ? 'border-[rgb(var(--fg-rgb)/0.08)] bg-[var(--learn-bar)] backdrop-blur-md'
          : 'border-[var(--line)] bg-[rgb(var(--bg-rgb)/0.95)] backdrop-blur-md'
      }`}
    >
      <div className="mx-auto flex min-h-16 w-full min-w-0 max-w-[1120px] flex-wrap items-center gap-y-1 px-3 sm:px-6">
        <HomeLink href="/" className="mr-2 flex shrink-0 items-center gap-2 rounded-md sm:mr-5" aria-label="Replay 首页">
          <ReplayMark className="grid h-8 w-8 place-items-center rounded-md bg-[var(--accent)]" />
          <span className="hidden text-[17px] font-semibold tracking-[-0.02em] text-[var(--text)] min-[480px]:block">
            Replay
          </span>
        </HomeLink>

        <nav className="flex h-16 shrink-0 items-stretch gap-0.5" aria-label="主导航">
          {links.map((link) => {
            const active = link.href === '/'
              ? pathname === '/'
              : link.href === '/#catalog'
                ? pathname.startsWith('/movie')
                : pathname.startsWith(link.href);
            // Entering or leaving the receiver must load the document's COOP policy.
            const NavLink = isDownload || link.href === '/download' ? 'a' : Link;
            return (
              <NavLink
                key={link.href}
                href={link.href}
                className={`relative flex shrink-0 items-center whitespace-nowrap px-1 text-[13px] transition-colors sm:px-3.5 sm:text-[14px] ${
                  isLearn
                    ? active ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                    : active ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                {link.label}
                {active && (
                  <span className={`absolute inset-x-2.5 bottom-0 h-0.5 sm:inset-x-3.5 ${isLearn ? 'bg-[#e0a94a]' : 'bg-[#fd8c73]'}`} />
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 pl-1 sm:gap-2 sm:pl-0">
          <a
            href="https://github.com/3121597355/replay"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Star on GitHub，查看 Replay 开源仓库"
            title="Star on GitHub · Replay 开源仓库"
            className="inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-2 text-[var(--text)] transition-colors hover:bg-[var(--surface-3)] sm:h-9 lg:px-3"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .297C5.37.297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.838 1.237 1.838 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.334-5.466-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.52 11.52 0 0 1 12 6.098c1.02.005 2.047.138 3.005.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.652.242 2.873.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.805 5.628-5.478 5.925.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .319.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            <span className="hidden whitespace-nowrap text-[13px] font-medium lg:inline">Star on GitHub</span>
          </a>
          <ThemeToggle />
          {isLearn ? (
            <span className="hidden text-[12px] text-[var(--text-faint)] sm:block">本地运行</span>
          ) : (
            <HomeLink href="/learn" className="btn btn-primary hidden !h-8 !px-3 !py-0 !text-[13px] sm:inline-flex">
              开始学习
            </HomeLink>
          )}
        </div>
      </div>
    </header>
  );
}
