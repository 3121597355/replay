'use client';

import { useState } from 'react';
import type { Work } from '@/lib/types';

export default function Poster({
  work,
  size = 'md',
  showTitle = true,
  priority = false,
}: {
  work: Work;
  size?: 'sm' | 'md' | 'lg';
  showTitle?: boolean;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [c1, c2] = work.accent;
  const raw = work.poster ?? `/posters/${work.slug}.webp`;
  const src = `${raw}${raw.includes('?') ? '&' : '?'}v=4`;

  return (
    <div
      className="poster-frame h-full w-full bg-[var(--surface-2)]"
      style={{ background: `linear-gradient(145deg, ${c1}22, ${c2}38)` }}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
        <span className={`brand-serif font-semibold text-[#536158]/20 ${size === 'sm' ? 'text-[42px]' : 'text-[68px]'}`}>
          {work.mark}
        </span>
        <span className="text-[11px] font-medium text-[#536158]/55">{work.title}</span>
      </div>

      {!failed && (
        <img
          src={src}
          alt={`${work.title}（${work.originalTitle}）海报`}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 z-10 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        />
      )}

      {showTitle && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <div className="text-[22px] font-semibold leading-tight text-white">{work.title}</div>
            <div className="mt-1 truncate text-[10px] uppercase tracking-[0.14em] text-white/65">
              {work.originalTitle}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
