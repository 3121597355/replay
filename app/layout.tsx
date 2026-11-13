import type { Metadata } from 'next';
import './globals.css';
import Nav from '@/components/Nav';
import ReplayMark from '@/components/ReplayMark';
import Analytics from '@/components/Analytics';
import AccountProvider from '@/components/account/AccountProvider';
import '@/components/account/account.css';
import { siteName, siteUrl, siteDescription } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${siteName}｜免费看剧练听力与口语`, template: `%s · ${siteName}` },
  applicationName: siteName,
  description: siteDescription,
  keywords: ['看剧学英语', '美剧', '英文字幕', 'Anki', '英语听力', '逐句精听'],
  openGraph: {
    title: `${siteName}｜免费看剧练听力与口语`,
    description: siteDescription,
    siteName,
    type: 'website',
    locale: 'zh_CN',
    images: [{ url: '/og-jushuo.png', width: 1200, height: 630, alt: '剧说英语：看剧练听力，跟读练口语' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteName}｜免费看剧练听力与口语`,
    description: siteDescription,
    images: ['/og-jushuo.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var saved=localStorage.getItem('replay-theme');var theme=saved==='light'||saved==='dark'?saved:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme;}catch(e){document.documentElement.dataset.theme='light';}})();`,
          }}
        />
        <Analytics />
      </head>
      <body>
        <AccountProvider>
        <Nav />
        <main>{children}</main>
        <footer className="border-t border-[var(--line)] bg-[var(--page)]">
          <div className="mx-auto flex max-w-[1120px] flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-2.5">
              <ReplayMark className="grid h-6 w-6 place-items-center rounded bg-[#1d873b]" />
              <span className="text-[14px] font-semibold text-[var(--text)]">剧说英语</span>
              <span className="text-[13px] text-[var(--text-faint)]">看剧练听力 · 跟读练口语</span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[var(--text-dim)]">
              <a href="/#catalog" className="hover:text-[var(--link)] hover:underline">浏览片单</a>
              <a href="/learn" className="hover:text-[var(--link)] hover:underline">学习台</a>
              <a href="/guides" className="hover:text-[var(--link)] hover:underline">学习指南</a>
              <a href="/privacy" className="hover:text-[var(--link)] hover:underline">隐私说明</a>
              <span className="text-[var(--text-faint)]">不提供片源与字幕</span>
            </div>
          </div>
        </footer>
        </AccountProvider>
      </body>
    </html>
  );
}
