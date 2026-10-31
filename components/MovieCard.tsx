import Link from 'next/link';
import type { Work } from '@/lib/types';
import { difficultyLabel, typeLabel } from '@/lib/types';
import Poster from './Poster';

const diffDot: Record<Work['difficulty'], string> = {
  easy: '#1f883d',
  medium: '#d4a72c',
  hard: '#cf222e',
};

export default function MovieCard({ work }: { work: Work }) {
  return (
    <Link
      href={`/movie/${work.slug}`}
      className="group flex h-full gap-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-card)]"
    >
      <div className="w-[92px] shrink-0 self-start overflow-hidden rounded-md border border-[var(--line-2)] bg-[var(--surface)]">
        <div className="aspect-[2/3] w-full">
          <Poster work={work} size="sm" showTitle={false} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate text-[16px] font-semibold leading-6 text-[var(--text)] group-hover:text-[var(--link)] group-hover:underline">
          {work.title}
        </h3>
        <p className="mt-0.5 truncate text-[13px] text-[var(--text-faint)]">
          {work.originalTitle} · {work.year}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--text-dim)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: diffDot[work.difficulty] }} aria-hidden="true" />
            {difficultyLabel[work.difficulty]}
          </span>
          <span aria-hidden="true">·</span>
          <span>{work.level}</span>
          <span aria-hidden="true">·</span>
          <span>{typeLabel[work.type]}</span>
        </div>

        <p className="mt-2.5 line-clamp-2 text-[13px] leading-[1.6] text-[var(--text-dim)]">
          {work.tagline}
        </p>

        <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[13px] font-medium text-[var(--link)]">
          学习指南
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </Link>
  );
}
