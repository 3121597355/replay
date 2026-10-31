import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getWork, works } from '@/lib/data';
import { difficultyLabel, typeLabel, subtitleLabel } from '@/lib/types';
import Poster from '@/components/Poster';
import CopyButton from '@/components/CopyButton';

export function generateStaticParams() {
  return works.map((work) => ({ slug: work.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const work = getWork(params.slug);
  if (!work) return { title: '找不到这部作品' };
  return {
    title: `${work.title} · 学习指南 · Replay`,
    description: work.whyLearn.slice(0, 120),
  };
}

export default function MoviePage({ params }: { params: { slug: string } }) {
  const work = getWork(params.slug);
  if (!work) notFound();

  const subQuery = work.type === 'series'
    ? `${work.originalTitle} S01E01 chs eng`
    : `${work.originalTitle} ${work.year} chs eng`;

  return (
    <div className="mx-auto max-w-[1120px] px-4 pb-14 pt-8 sm:px-6 sm:pt-10">
      <nav className="flex items-center gap-2 text-[13px] text-[var(--text-faint)]" aria-label="面包屑">
        <Link href="/" className="hover:text-[var(--link)] hover:underline">首页</Link>
        <span aria-hidden="true">/</span>
        <Link href="/#catalog" className="hover:text-[var(--link)] hover:underline">片单</Link>
        <span aria-hidden="true">/</span>
        <span className="truncate text-[var(--text)]">{work.title}</span>
      </nav>

      <div className="mt-7 grid grid-cols-1 gap-9 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-12">
        <aside>
          <div className="mx-auto w-[200px] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] md:w-full">
            <div className="aspect-[2/3] w-full">
              <Poster work={work} size="lg" showTitle={false} priority />
            </div>
          </div>
          <Link href={`/learn?from=${work.slug}`} className="btn btn-primary mt-4 hidden w-full md:flex">
            开始学习
          </Link>
        </aside>

        <article className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-[var(--text-faint)]">
            <span>{typeLabel[work.type]}</span>
            <span aria-hidden="true">·</span>
            <span>{work.genres.join(' / ')}</span>
          </div>

          <h1 className="mt-2 text-[36px] font-bold leading-tight tracking-[-0.04em] text-[var(--text)] sm:text-[44px]">{work.title}</h1>
          <p className="mt-2 text-[14px] text-[var(--text-faint)]">
            {work.originalTitle} · {work.year} · 豆瓣 {work.rating.toFixed(1)}
          </p>

          <p className="mt-5 text-[18px] font-medium leading-[1.6] text-[var(--text)]">{work.tagline}</p>
          <p className="mt-3 max-w-[700px] text-[15px] leading-[1.75] text-[var(--text-dim)]">{work.description}</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/learn?from=${work.slug}`} className="btn btn-primary md:hidden">
              开始学习
            </Link>
            <a href="#prepare" className="btn btn-secondary">准备视频和字幕</a>
          </div>

          <dl className="mt-8 grid grid-cols-2 gap-y-4 border-y border-[var(--line)] py-4 sm:grid-cols-4">
            {[
              ['难度', difficultyLabel[work.difficulty]],
              ['建议水平', work.level],
              ['字幕适配', subtitleLabel[work.subtitleQuality]],
              ['片长', work.runtime ?? '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[12px] text-[var(--text-faint)]">{label}</dt>
                <dd className="mt-1 text-[14px] font-medium text-[var(--text)]">{value}</dd>
              </div>
            ))}
          </dl>

          <section className="mt-8 border-l-[3px] border-[var(--accent)] pl-4" aria-labelledby="why-learn">
            <h2 id="why-learn" className="text-[18px] font-semibold text-[var(--text)]">为什么适合学英语</h2>
            <p className="mt-2.5 text-[15px] leading-[1.8] text-[var(--text-dim)]">{work.whyLearn}</p>
          </section>

          <section className="mt-9" aria-labelledby="phrases-title">
            <h2 id="phrases-title" className="text-[18px] font-semibold text-[var(--text)]">经典台词</h2>
            <div className="mt-3 border-y border-[var(--line)]">
              {work.phrases.map((phrase) => (
                <blockquote key={phrase} className="border-b border-[var(--line-2)] py-3 last:border-b-0">
                  <p className="font-mono text-[14px] leading-[1.7] text-[var(--text-soft)]">“{phrase}”</p>
                </blockquote>
              ))}
            </div>
          </section>

          <section id="prepare" className="mt-9" aria-labelledby="prepare-title">
            <h2 id="prepare-title" className="text-[18px] font-semibold text-[var(--text)]">准备视频和字幕</h2>
            <ol className="mt-3 divide-y divide-[var(--line-2)] border-y border-[var(--line)]">
              <Step n="1" title="准备片源" hint={work.platforms.join(' / ')}>
                使用你已有的视频副本。本站不托管、不分发任何片源。
              </Step>
              <Step n="2" title="搜索字幕" hint="srt / vtt / ass">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="select-all rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--text-soft)]">{subQuery}</code>
                  <CopyButton text={subQuery} />
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-faint)]">视频自带字幕轨时，也可以在学习台直接提取。</p>
              </Step>
              <Step n="3" title="导入学习台">
                视频和字幕都在本地读取。逐句精听、点词收藏，最后导出到 Anki。
              </Step>
            </ol>
            <div className="mt-6">
              <Link href={`/learn?from=${work.slug}`} className="btn btn-primary">打开学习台</Link>
            </div>
          </section>

          <p className="mt-6 text-[12px] leading-relaxed text-[var(--text-faint)]">请使用你合法拥有的视频与字幕副本进行学习。</p>
        </article>
      </div>
    </div>
  );
}

function Step({ n, title, hint, children }: { n: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[24px_1fr] gap-3 py-4">
      <span className="grid h-6 w-6 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[12px] font-semibold tnum text-[var(--text-dim)]">{n}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-[14px] font-semibold text-[var(--text)]">{title}</h3>
          {hint && <span className="text-[12px] text-[var(--text-faint)]">{hint}</span>}
        </div>
        <div className="mt-1.5 text-[14px] leading-[1.7] text-[var(--text-dim)]">{children}</div>
      </div>
    </li>
  );
}
