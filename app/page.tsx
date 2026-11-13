import Link from 'next/link';
import Catalog from '@/components/Catalog';
import Poster from '@/components/Poster';
import HomeMotion from '@/components/HomeMotion';
import HomeFilmBackdrop from '@/components/HomeFilmBackdrop';
import { getWork, works } from '@/lib/data';
import { difficultyLabel } from '@/lib/types';
import { siteName, siteUrl } from '@/lib/site';
export const metadata = { alternates: { canonical: '/' }, openGraph: { url: '/', title: '剧说英语｜免费看剧练听力与口语' } };

const featuredSlugs = ['friends', 'breaking-bad', 'better-call-saul', 'game-of-thrones'];
const featured = featuredSlugs
  .map((slug) => getWork(slug))
  .filter((work): work is NonNullable<typeof work> => Boolean(work));

export default function HomePage() {
  return (
    <HomeMotion>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: siteName, alternateName: 'Replay', url: siteUrl }).replace(/</g, '\\u003c') }} />
      <section className="home-film-hero">
        <HomeFilmBackdrop />
        <div className="home-hero">
          <p className="home-intro home-hero-eyebrow">剧说英语 <span aria-hidden="true">·</span> 核心功能免费</p>
          <h1 className="home-intro home-hero-title">
            看剧练听力<br />跟读练口语
          </h1>
          <p className="home-intro home-hero-copy [animation-delay:60ms]">
            电影、美剧、播客、新闻，都能成为英语素材。
            <span className="home-hero-features">导入视频或音频＋字幕 · 逐句精听 · 录音跟读 · 收藏原句回放</span>
          </p>
          <div className="home-intro home-hero-actions [animation-delay:120ms]">
            <Link href="/learn?trial=1" className="btn btn-primary">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="m5 3 7 5-7 5V3Z" fill="currentColor" />
              </svg>
              先免费试学
            </Link>
            <Link href="/learn" className="btn btn-secondary">开始完整学习</Link>
          </div>
        </div>
      </section>

      <section className="home-benefits border-y border-[var(--line)] bg-[var(--surface)]">
        <div className="home-benefits-grid mx-auto grid max-w-[1120px] gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6 sm:py-12">
          {[
            {
              title: '视频、音频不上传',
              text: '素材、字幕和收藏保存在本机；账号记录学习时间和天数。',
              icon: 'M10 1.8 17 4.5v5.1c0 4.2-2.8 7.1-7 8.6-4.2-1.5-7-4.4-7-8.6V4.5l7-2.7Zm-3 8.2 2.2 2.2 4-4',
            },
            {
              title: '逐句精听',
              text: '看剧或听播客，都能跟随字幕循环一句、调整语速，再录音跟读。',
              icon: 'M10 2.2c4.3 0 7.8 3.5 7.8 7.8s-3.5 7.8-7.8 7.8S2.2 14.3 2.2 10 5.7 2.2 10 2.2Zm-2.2 5v5.6L12.5 10 7.8 7.2Z',
            },
            {
              title: '收藏原句，再听一遍',
              text: '翻卡复习时重放原声，找回语境和语气；也能导出到 Anki。',
              icon: 'M3 3h14v11H3V3Zm3.5 14h7M10 14v3M6.5 7h7M6.5 10h4.5',
            },
          ].map((item, index) => (
            <div key={item.title} className="group" data-reveal data-reveal-delay={index * 100}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-[var(--accent)] transition-transform duration-300 ease-out group-hover:-translate-y-0.5" aria-hidden="true">
                <path d={item.icon} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h2 className="mt-3 text-[15px] font-semibold text-[var(--text)]">{item.title}</h2>
              <p className="mt-1.5 text-pretty text-[14px] leading-[1.65] text-[var(--text-dim)]">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1120px] px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="featured-title">
        <div className="flex items-end justify-between gap-6">
          <div data-reveal>
            <h2 id="featured-title" className="text-[28px] font-bold tracking-[-0.035em] text-[var(--text)] sm:text-[32px]">推荐作品</h2>
            <p className="mt-2 text-[14px] text-[var(--text-dim)]">从日常对话到史诗剧集，按自己的水平选择。</p>
          </div>
          <a href="#catalog" data-reveal data-reveal-delay="60" className="group inline-flex shrink-0 items-center gap-1 text-[14px] font-medium text-[var(--link)] hover:underline">
            查看全部 {works.length} 部
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4 lg:gap-x-6">
          {featured.map((work, index) => (
            <Link
              key={work.slug}
              href={`/movie/${work.slug}`}
              className="group min-w-0"
              data-reveal
              data-reveal-delay={index * 120}
            >
              <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] transition-[transform,border-color,box-shadow] duration-300 ease-out group-hover:-translate-y-1 group-hover:border-[var(--line-strong)] group-hover:shadow-[0_18px_36px_-26px_rgba(31,35,40,0.55)]">
                <div className="aspect-[2/3] w-full">
                  <Poster work={work} size="md" showTitle={false} priority />
                </div>
              </div>
              <h3 className="mt-3 text-[16px] font-semibold text-[var(--text)] transition-colors group-hover:text-[var(--link)] group-hover:underline">
                {work.title}
              </h3>
              <p className="mt-0.5 truncate text-[13px] text-[var(--text-faint)]">{work.originalTitle} · {work.year}</p>
              <p className="mt-2 text-[12px] text-[var(--text-faint)]">{difficultyLabel[work.difficulty]} · {work.level}</p>
            </Link>
          ))}
        </div>
      </section>

      <section id="catalog" className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-8 max-w-[720px]" data-reveal>
            <h2 className="text-[28px] font-bold tracking-[-0.035em] text-[var(--text)] sm:text-[32px]">浏览片单</h2>
            <p className="mt-2 text-[14px] leading-[1.7] text-[var(--text-dim)]">
              按难度、类型或关键词筛选。片源与字幕请使用你合法拥有的副本。
            </p>
          </div>
          <Catalog />
        </div>
      </section>

      <div className="border-t border-[var(--line)]">
        <div data-reveal className="mx-auto flex max-w-[1120px] items-center gap-2 px-4 py-5 text-[13px] text-[var(--text-faint)] sm:px-6">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
            <path d="M8 1.8 13.5 4v4c0 3.3-2.2 5.6-5.5 6.8C4.7 13.6 2.5 11.3 2.5 8V4L8 1.8Zm-2.3 6.5 1.7 1.7 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          视频、音频和字幕只在浏览器中读取，不会上传到服务器。
        </div>
      </div>
    </HomeMotion>
  );
}
