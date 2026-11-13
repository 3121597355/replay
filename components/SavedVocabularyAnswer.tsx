'use client';
import { useEffect, useState } from 'react';
import type { SavedWord } from '@/lib/types';
import { getStorageOwner } from '@/lib/account-storage';
import { loadSavedWords, persistSavedWords } from '@/lib/saved-words';
import { isSentenceCollection, resolveSavedSentenceTranslation, storedSentenceTranslation } from '@/lib/saved-sentence';

export default function SavedVocabularyAnswer({ word, enabled }: { word: SavedWord; enabled: boolean }) {
  const [recovered, setRecovered] = useState(''), [busy, setBusy] = useState(false);
  const stored = storedSentenceTranslation(word), owner = getStorageOwner();
  useEffect(() => {
    let cancelled = false; setRecovered(''); setBusy(false);
    if (!enabled || stored) return;
    setBusy(true);
    void resolveSavedSentenceTranslation(word, owner).then(value => {
      if (cancelled) return;
      setRecovered(value);
      if (!value) return;
      const words = loadSavedWords(owner), index = words.findIndex(item => item.addedAt === word.addedAt && item.word === word.word && item.sentence === word.sentence);
      if (index >= 0 && !words[index].sentenceTranslation) {
        words[index] = { ...words[index], sentenceTranslation: value };
        if (persistSavedWords(words, owner)) window.dispatchEvent(new CustomEvent('replay:saved-words-updated', { detail: owner }));
      }
    }).catch(() => {}).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [word, enabled, owner, stored]);
  const translation = stored || recovered;
  return <><span className="vocab-flip-label">原句与译文</span><p className="vocab-original-sentence" lang="en">{word.sentence || word.word}</p>
    <p className="vocab-answer-translation" lang="zh-CN" data-sentence-translation>{translation || (busy ? '正在读取原句译文…' : '原句译文尚未保存，请回学习台翻译后重新收藏。')}</p>
    {!isSentenceCollection(word) && <div className="vocab-word-meaning"><span>单词释义 · {word.word}</span><p data-word-definition>{word.translation || '这个词还没有释义。'}</p></div>}
  </>;
}
