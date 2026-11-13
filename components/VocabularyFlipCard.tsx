'use client';

import { useState, type ReactNode } from 'react';
import { useVocabularyMotion } from './VocabularyMotion';

export default function VocabularyFlipCard({ front, back, label, answerLabel, flipped, onFlip }: {
  front: ReactNode; back: ReactNode; label: string; answerLabel: string; flipped?: boolean; onFlip?: (value: boolean) => void;
}) {
  const [localFlipped, setLocalFlipped] = useState(false);
  const motion = useVocabularyMotion();
  const showingAnswer = flipped ?? localFlipped;
  const toggle = () => { const next = !showingAnswer; setLocalFlipped(next); onFlip?.(next); };
  return <div className="vocab-flip-card" data-flipped={showingAnswer} data-motion={motion ? 'on' : 'off'} role="button" tabIndex={0}
    aria-pressed={showingAnswer} aria-label={showingAnswer ? `${answerLabel}。点击返回英文` : `${label}。点击翻看释义`}
    onClick={toggle} onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggle(); }
    }}>
    <div className="vocab-flip-inner">
      <div className="vocab-flip-face vocab-flip-front" aria-hidden={showingAnswer}>{front}<span className="vocab-flip-hint">点击翻看释义 ↻</span></div>
      <div className="vocab-flip-face vocab-flip-back" aria-hidden={!showingAnswer}>{back}<span className="vocab-flip-hint">点击回到英文 ↻</span></div>
    </div>
  </div>;
}
