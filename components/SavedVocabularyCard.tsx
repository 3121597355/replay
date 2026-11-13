'use client';

import type { SavedWord } from '@/lib/types';
import { speak } from '@/lib/dict';
import VocabularyFlipCard from './VocabularyFlipCard';
import SavedLineReplay, { stopOriginalLinePlayback } from './SavedLineReplay';
import { useState } from 'react';
import SavedVocabularyAnswer from './SavedVocabularyAnswer';
import { savedSentenceAnswerLabel } from '@/lib/saved-sentence';
import VocabularyAudioIcon from './VocabularyAudioIcon';

export default function SavedVocabularyCard({ word, onRemove }: { word: SavedWord; onRemove: () => void }) {
  const [flipped, setFlipped] = useState(false);
  return <article className="saved-vocab-card">
    <div className="saved-vocab-tools"><button type="button" className="vocab-audio-action" onClick={() => { stopOriginalLinePlayback(); speak(word.word || word.sentence); }} aria-label={`听发音：${word.word || word.sentence}`} title="听单词发音"><VocabularyAudioIcon kind="speaker" /><span>听单词发音</span></button><button type="button" onClick={onRemove} aria-label={`移除收藏：${word.word || word.sentence}`}>移除</button></div>
    <VocabularyFlipCard flipped={flipped} onFlip={setFlipped} label={word.word || word.sentence} answerLabel={savedSentenceAnswerLabel(word)}
      front={<><span className="vocab-flip-label">英文 · 先想想意思</span>{word.word && <h3 lang="en">{word.word}</h3>}{word.sentence !== word.word && <p lang="en">{word.sentence}</p>}</>}
      back={<SavedVocabularyAnswer word={word} enabled={flipped} />} />
    <SavedLineReplay word={word} />
  </article>;
}
