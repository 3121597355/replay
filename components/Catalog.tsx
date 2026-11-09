'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, WorkType } from '@/lib/types';
import { works } from '@/lib/data';
import MovieCard from './MovieCard';

type SortKey = 'rating' | 'easy' | 'hard' | 'year';

const typeOptions: { key: WorkType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'series', label: '剧集' },
  { key: 'movie', label: '电影' },
  { key: 'podcast', label: '播客' },
];

const diffRank: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };
const PAGE_SIZE = 9;

export default function Catalog() {
  const [q, setQ] = useState('');
  const [diff, setDiff] = useState<Difficulty | 'all'>('all');
  const [type, setType] = useState<WorkType | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('rating');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === '/' && !editing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        setQ('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setVisible(PAGE_SIZE), [q, diff, type, sort]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const filtered = works.filter((work) => {
      const hitQ = !query || [work.title, work.originalTitle, work.tagline, ...work.genres, ...work.phrases]
        .join(' ')
        .toLowerCase()
        .includes(query);
      return hitQ && (diff === 'all' || work.difficulty === diff) && (type === 'all' || work.type === type);
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'rating') return b.rating - a.rating;
      if (sort === 'easy') return diffRank[a.difficulty] - diffRank[b.difficulty] || b.rating - a.rating;
      if (sort === 'hard') return diffRank[b.difficulty] - diffRank[a.difficulty] || b.rating - a.rating;
      return b.year - a.year;
    });
  }, [q, diff, type, sort]);

  const hasFilters = Boolean(q || diff !== 'all' || type !== 'all' || sort !== 'rating');
  const reset = () => {
    setQ('');
    setDiff('all');
    setType('all');
    setSort('rating');
  };

  return (
    <div>
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-4">
        <div className="relative">
          <label htmlFor="catalog-search" className="sr-only">搜索片单</label>
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.7" stroke="currentColor" strokeWidth="1.4" />
            <path d="m11 11 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            id="catalog-search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜索片名、类型或一句台词"
            className="field-control h-10 bg-[var(--page)] pl-9 pr-14"
          />
          {q ? (
            <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-1 text-[12px] text-[var(--text-dim)] hover:bg-[var(--surface-2)]" aria-label="清空搜索">
              清空
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[var(--line)] bg-[var(--page)] px-1.5 py-0.5 font-sans text-[11px] text-[var(--text-faint)]">/</kbd>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <div className="flex w-full rounded-md border border-[var(--line)] bg-[var(--page)] p-[3px] sm:inline-flex sm:w-auto" role="group" aria-label="按类型筛选">
            {typeOptions.map((option) => (
              <button
                key={option.key}
                onClick={() => setType(option.key)}
                aria-pressed={type === option.key}
                className={`flex-1 rounded px-2.5 py-1 text-[13px] transition-colors sm:flex-none ${
                  type === option.key
                    ? 'bg-[var(--surface-2)] font-semibold text-[var(--text)]'
                    : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="grid w-full grid-cols-2 gap-2.5 sm:flex sm:w-auto sm:items-center">
            <label className="sr-only" htmlFor="difficulty-filter">难度筛选</label>
            <select id="difficulty-filter" value={diff} onChange={(event) => setDiff(event.target.value as Difficulty | 'all')} className="select-control !h-9 !text-[13px] sm:!w-auto">
              <option value="all">全部难度</option>
              <option value="easy">入门</option>
              <option value="medium">进阶</option>
              <option value="hard">挑战</option>
            </select>

            <label className="sr-only" htmlFor="sort-filter">排序方式</label>
            <select id="sort-filter" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="select-control !h-9 !text-[13px] sm:!w-auto">
              <option value="rating">口碑优先</option>
              <option value="easy">由易到难</option>
              <option value="hard">由难到易</option>
              <option value="year">年份最新</option>
            </select>
          </div>

          <div className="ml-auto flex w-full items-center justify-end gap-3 text-[13px] text-[var(--text-dim)] sm:w-auto sm:justify-start" aria-live="polite">
            <span className="tnum">共 {list.length} 部</span>
            {hasFilters && (
              <button onClick={reset} className="font-medium text-[var(--link)] hover:underline">重置</button>
            )}
          </div>
        </div>
      </div>

      {list.length > 0 ? (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.slice(0, visible).map((work, index) => (
              <div
                key={work.slug}
                className="min-w-0"
                data-reveal
                data-reveal-delay={(index % 3) * 100}
              >
                <MovieCard work={work} />
              </div>
            ))}
          </div>

          <div className="mt-7 flex flex-col items-center gap-3">
            <p className="text-[12px] text-[var(--text-faint)] tnum">已显示 {Math.min(visible, list.length)} / {list.length}</p>
            {visible < list.length && (
              <button onClick={() => setVisible((count) => count + PAGE_SIZE)} className="btn btn-secondary !h-9 !px-4 !py-0 !text-[13px]">
                再看一些
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </>
      ) : (
        <div data-reveal className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-6 py-16 text-center">
          <h3 className="text-[16px] font-semibold text-[var(--text)]">没有找到匹配的作品</h3>
          <p className="mt-1.5 text-[14px] text-[var(--text-dim)]">换个关键词，或清除难度和类型筛选试试。</p>
          <button onClick={reset} className="btn btn-secondary mt-5 !h-9 !px-4 !py-0 !text-[13px]">清空筛选</button>
        </div>
      )}
    </div>
  );
}
