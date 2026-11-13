'use client';

import type { SavedWord } from '@/lib/types';
import { speak } from '@/lib/dict';
import VocabularyFlipCard from './VocabularyFlipCard';
import SavedLineReplay, { stopOriginalLinePlayback } from './SavedLineReplay';

export default function SavedVocabularyCard({ word, onRemove }: { word: SavedWord; onRemove: () => void }) {
  const answer = word.translation || '这条收藏还没有译文，可以回到学习台补充。';
  return <article className="saved-vocab-card">
    <div className="saved-vocab-tools"><button type="button" onClick={() => { stopOriginalLinePlayback(); speak(word.word || word.sentence); }} aria-label={`听发音：${word.word || word.sentence}`} title="听单词发音">♬ 听单词发音</button><button type="button" onClick={onRemove} aria-label={`移除收藏：${word.word || word.sentence}`}>移除</button></div>
    <VocabularyFlipCard label={word.word || word.sentence} answerLabel={answer}
      front={<><span className="vocab-flip-label">英文 · 先想想意思</span>{word.word && <h3 lang="en">{word.word}</h3>}{word.sentence !== word.word && <p lang="en">{word.sentence}</p>}</>}
      back={<><span className="vocab-flip-label">释义与译文</span><p>{answer}</p></>} />
    <SavedLineReplay word={word} />
  </article>;
}
