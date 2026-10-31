'use client';

import type { LookupResult } from '@/lib/dict';
import { speak } from '@/lib/dict';

export interface LookupState {
  word: string;
  sentence: string;
  /** null 表示词典里没有 */
  result: LookupResult | null;
  loading: boolean;
}

export default function WordCard({
  state,
  onClose,
  onSave,
  isSaved,
}: {
  state: LookupState | null;
  onClose: () => void;
  onSave: (word: string, sentence: string, def: string) => void;
  isSaved: (word: string) => boolean;
}) {
  if (!state) return null;

  const { word, sentence, result, loading } = state;
  const headword = result?.headword ?? word;
  const phonetic = result?.entry.p;
  const defs = result?.entry.c ?? [];
  const saved = isSaved(headword);

  return (
    <div className="shrink-0 border-b border-white/8 bg-[#0d0d14]">
      <div className="px-4 py-3">
        {/* 词 + 音标 + 操作 */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="title-serif text-[18px] font-semibold text-white/95">{headword}</span>
              {phonetic && (
                <span className="font-mono text-[11.5px] text-white/35">{phonetic}</span>
              )}
              <button
                onClick={() => speak(headword)}
                title="朗读"
                className="grid h-5 w-5 place-items-center rounded text-white/30 transition-colors hover bg-transparent hover:bg-white/8 hover:text-gold-400"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M4 9.5h3l4-3v11l-4-3H4v-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M15 9.2c.9.7 1.4 1.7 1.4 2.8s-.5 2.1-1.4 2.8M17.6 6.8c1.5 1.3 2.4 3.1 2.4 5.2s-.9 3.9-2.4 5.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              {result?.viaLemma && (
                <span className="rounded bg-white/6 px-1.5 py-0.5 text-[9.5px] text-white/35">
                  {word} 的变形
                </span>
              )}
            </div>

            {/* 释义 */}
            <div className="mt-1.5">
              {loading ? (
                <span className="text-[12.5px] text-white/25">查…</span>
              ) : defs.length > 0 ? (
                <ul className="space-y-0.5">
                  {defs.map((d, i) => (
                    <li key={i} className="text-[12.5px] leading-relaxed text-white/60">
                      {d}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] leading-relaxed text-white/28">
                  本地词典没收录这个词。
                  <span className="text-white/40">可以做但不假装有——</span>
                  点别的词试试。
                </p>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            title="关闭"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-white/25 transition-colors hover:bg-white/8 hover:text-white/70"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 原句 */}
        {sentence && (
          <p className="mt-2.5 line-clamp-2 border-l-2 border-white/10 pl-2.5 text-[11.5px] italic leading-relaxed text-white/32">
            {highlight(sentence, word)}
          </p>
        )}

        {/* 收藏 */}
        {defs.length > 0 && (
          <button
            onClick={() => onSave(headword, sentence, defs.join('；'))}
            disabled={saved}
            className={`mt-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-all ${
              saved
                ? 'border-emerald-400/30 bg-emerald-400/8 text-emerald-300'
                : 'border-white/12 text-white/50 hover:border-gold-500/40 hover:text-gold-400'
            }`}
          >
            {saved ? (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="m5 13 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                已在生词本
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8L12 3.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                加入生词本
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/** 把原句里命中的那个词标出来，帮用户定位上下文。 */
function highlight(sentence: string, word: string) {
  const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
  const parts = sentence.split(re);
  if (parts.length === 1) return sentence;
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <span key={i} className="not-italic text-gold-400/85">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}
