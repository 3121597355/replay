'use client';
import { useCallback, useEffect, useState } from 'react';
import { loadSavedWords } from '@/lib/saved-words';
import { storageKey } from '@/lib/account-storage';
import { speak } from '@/lib/dict';
import type { SavedWord } from '@/lib/types';
import LearningActivity from './LearningActivity';
import VocabularyFlipCard from '@/components/VocabularyFlipCard';
import VocabularyMotionToggle from '@/components/VocabularyMotion';
import SavedLineReplay, { stopOriginalLinePlayback } from '@/components/SavedLineReplay';
import { parseReviewSchedule, type ReviewSchedule as Schedule } from '@/lib/review-schedule';
import SavedVocabularyAnswer from '@/components/SavedVocabularyAnswer';
import { getStorageOwner } from '@/lib/account-storage';
import { savedSentenceAnswerLabel } from '@/lib/saved-sentence';
import VocabularyAudioIcon from '@/components/VocabularyAudioIcon';
const identity = (word: SavedWord) => `${word.word.toLowerCase()}:${word.addedAt}`;
export default function ReviewCards() {
  const [cards, setCards] = useState<SavedWord[]>([]), [schedule, setSchedule] = useState<Schedule>({}), [index, setIndex] = useState(0), [answer, setAnswer] = useState(false), [ready, setReady] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => {
    let previous: Schedule = {};
    try { previous = parseReviewSchedule(JSON.parse(localStorage.getItem(storageKey('replay.review')) || '{}')); } catch {}
    setSchedule(previous); setCards(loadSavedWords().filter(word => !Number.isFinite(previous[identity(word)]?.due) || previous[identity(word)].due <= Date.now())); setReady(true);
    const owner = getStorageOwner();
    const update = (event: Event) => { if ((event as CustomEvent<string>).detail !== owner) return; const saved = loadSavedWords(owner); setCards(items => items.map(item => saved.find(word => identity(word) === identity(item) && word.sentence === item.sentence) || item)); };
    window.addEventListener('replay:saved-words-updated', update);
    return () => window.removeEventListener('replay:saved-words-updated', update);
  }, []);
  const current = cards[index];
  const finish = useCallback((remembered: boolean) => {
    if (!current) return;
    const key = identity(current), stage = remembered ? Math.min(5, (schedule[key]?.stage || 0) + 1) : 0;
    const days = [0, 1, 3, 7, 14, 30][stage];
    const next = { ...schedule, [key]: { stage, due: Date.now() + (remembered ? days * 86400000 : 10 * 60000) } };
    try { localStorage.setItem(storageKey('replay.review'), JSON.stringify(next)); stopOriginalLinePlayback(); window.speechSynthesis?.cancel(); setSchedule(next); setIndex(index + 1); setAnswer(false); window.dispatchEvent(new CustomEvent('replay:learning-action', { detail: 'review_complete' })); }
    catch { setNotice('浏览器暂时无法保存复习进度，请检查存储空间后重试。'); }
  }, [current, schedule, index]);
  useEffect(() => {
    if (!current) return;
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || document.visibilityState !== 'visible') return;
      if (event.target instanceof Element && event.target.closest('button,a,input,textarea,select,video,audio,[role="button"],[contenteditable]')) return;
      if (event.key === ' ') { event.preventDefault(); setAnswer(value => !value); }
      else if (answer && (event.key === '1' || event.key === '2')) { event.preventDefault(); finish(event.key === '2'); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [current, answer, finish]);
  const sentenceOnly = !current?.word || current.word === current.sentence;
  return <div className="account-review review-page">
    <LearningActivity enabled={ready && !!current} review />
    <a href="/account" className="review-back-link">← 学习概览</a>
    <header className="review-page-heading"><span className="account-eyebrow">收藏复习</span><h1>再练一遍，记得更牢。</h1><p>先回忆意思，听听原声，再翻面检查答案。</p></header>
    {notice && <div role="status" className="account-inline-note">{notice}</div>}
    {!ready ? <div className="account-card" role="status">正在读取本机收藏…</div> : current ? <>
      <div className="review-session-bar"><span>本轮复习 <strong>{index + 1}<span> / {cards.length}</span></strong></span><VocabularyMotionToggle /></div>
      <div className="review-progress" role="progressbar" aria-label="本轮已完成" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={index}><span style={{ width: `${index / cards.length * 100}%` }} /></div>
      <div className="review-workspace">
      <section className="review-main">
        <div className="review-content">
          <div className="review-audio-heading"><span className="review-step">01</span><h2>回忆与释义</h2></div>
          <p className="review-source-name">先回忆意思，再翻面检查答案。</p>
          <div className="account-flashcard review-flashcard">
            <VocabularyFlipCard key={identity(current)} flipped={answer} onFlip={setAnswer} label={current.word || current.sentence} answerLabel={savedSentenceAnswerLabel(current)}
              front={<><span className="vocab-flip-label">{sentenceOnly ? '英文原句' : '收藏的表达'}</span>{!sentenceOnly && <h2 lang="en">{current.word}</h2>}<p className="account-review-sentence" lang="en">{current.sentence || current.word}</p></>}
              back={<SavedVocabularyAnswer word={current} enabled={answer} />} />
          </div>
        </div>
        <div className="review-decision-bar">
          {answer ? <div className="review-decision-buttons"><button type="button" className="btn btn-secondary" onClick={() => finish(false)}>还不熟，稍后再练</button><button type="button" className="btn btn-primary" onClick={() => finish(true)}>记住了，下一句</button></div> : <button type="button" className="btn btn-primary review-reveal" onClick={() => setAnswer(true)}>翻看答案</button>}
          <p className="review-keyboard-hint">空格翻面{answer && ' · 1 稍后再练 · 2 记住了'}</p>
        </div>
      </section>
      <aside className="review-audio" aria-label="原句与发音">
        <div className="review-audio-heading"><span className="review-step">02</span><h2>原声与发音</h2></div>
        <p className="review-source-name" title={current.clip?.videoName}>{current.clip?.videoName || '收藏对应的影视或音频'}</p>
        <div className="account-original-actions">
          <SavedLineReplay key={identity(current)} word={current} idleContent={<div className="review-audio-idle"><span><VocabularyAudioIcon kind="play" /></span><strong>这句台词，是怎么说的？</strong><p>点击播放原句，听听原来的语气。</p></div>} />
          <button type="button" className="vocab-audio-action" onClick={() => { stopOriginalLinePlayback(); speak(current.word || current.sentence); }}><VocabularyAudioIcon kind="speaker" /><span>{sentenceOnly ? '听句子发音' : '听单词发音'}</span></button>
        </div>
        <p className="review-audio-note">原声播到句尾会停下，可以跟着说一遍。</p>
      </aside>
      <span className="sr-only" role="status" aria-live="polite">第 {index + 1} 条，共 {cards.length} 条：{current.word || current.sentence}</span>
    </div></> : <section className="account-card review-empty"><h2>{cards.length ? '这轮复习完成了。' : '今天没有待复习的收藏。'}</h2><p>{cards.length ? `已复习 ${cards.length} 个表达，下次按复习时间继续。` : '去学习台收藏几个词和句子，回来就能练。已有收藏按计划到期后会出现在这里。'}</p><a href="/learn" className="btn btn-primary">回学习台</a></section>}
    <p className="review-storage-note">收藏、原素材和复习进度保存在这台设备，无需上传。</p>
  </div>;
}
