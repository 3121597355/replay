import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:4310'),
  title: 'Replay · 看剧学英语',
  description: '导入自己的视频和字幕，逐句精听、查词和收藏，最后导出到 Anki。视频不上传。',
  keywords: ['看剧学英语', '美剧', '英文字幕', 'Anki', '英语听力', '逐句精听'],
  openGraph: {
    title: 'Replay · 看剧学英语',
    description: '导入自己的视频和字幕，逐句精听、查词和收藏，最后导出到 Anki。',
    type: 'website',
    locale: 'zh_CN',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Replay 看剧学英语' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Replay · 看剧学英语',
    description: '导入自己的视频和字幕，逐句精听、查词和收藏，最后导出到 Anki。',
    images: ['/og.png'],
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
        <script defer src="https://cloud.umami.is/script.js" data-website-id="10592750-fb71-440a-8f01-bd7e7233432c" />
      </head>
      <body>
        <Nav />
        <main>{children}</main>
        <footer className="border-t border-[var(--line)] bg-[var(--page)]">
          <div className="mx-auto flex max-w-[1120px] flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-2.5">
              <span className="grid h-6 w-6 place-items-center rounded bg-[var(--accent)]">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="m5.6 4.5 5 3.5-5 3.5v-7Z" fill="white" />
                </svg>
              </span>
              <span className="text-[14px] font-semibold text-[var(--text)]">Replay</span>
              <span className="text-[13px] text-[var(--text-faint)]">看剧学英语</span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[var(--text-dim)]">
              <Link href="/#catalog" className="hover:text-[var(--link)] hover:underline">浏览片单</Link>
              <Link href="/learn" className="hover:text-[var(--link)] hover:underline">学习台</Link>
              <span className="text-[var(--text-faint)]">不提供片源与字幕</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
