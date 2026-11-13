'use client';
import { useEffect, useState } from 'react';
import { loadSavedWords } from '@/lib/saved-words';
import { storageKey } from '@/lib/account-storage';
import { speak } from '@/lib/dict';
import type { SavedWord } from '@/lib/types';
import LearningActivity from './LearningActivity';
import VocabularyFlipCard from '@/components/VocabularyFlipCard';
import VocabularyMotionToggle from '@/components/VocabularyMotion';
import SavedLineReplay, { stopOriginalLinePlayback } from '@/components/SavedLineReplay';
import { parseReviewSchedule, type ReviewSchedule as Schedule } from '@/lib/review-schedule';
const identity = (word: SavedWord) => `${word.word.toLowerCase()}:${word.addedAt}`;
export default function ReviewCards() {
  const [cards, setCards] = useState<SavedWord[]>([]), [schedule, setSchedule] = useState<Schedule>({}), [index, setIndex] = useState(0), [answer, setAnswer] = useState(false), [ready, setReady] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => {
    let previous: Schedule = {};
    try { previous = parseReviewSchedule(JSON.parse(localStorage.getItem(storageKey('replay.review')) || '{}')); } catch {}
    setSchedule(previous); setCards(loadSavedWords().filter(word => !Number.isFinite(previous[identity(word)]?.due) || previous[identity(word)].due <= Date.now())); setReady(true);
  }, []);
  const current = cards[index];
  function finish(remembered: boolean) {
    if (!current) return;
    const key = identity(current), stage = remembered ? Math.min(5, (schedule[key]?.stage || 0) + 1) : 0;
    const days = [0, 1, 3, 7, 14, 30][stage];
    const next = { ...schedule, [key]: { stage, due: Date.now() + (remembered ? days * 86400000 : 10 * 60000) } };
    try { localStorage.setItem(storageKey('replay.review'), JSON.stringify(next)); setSchedule(next); setIndex(index + 1); setAnswer(false); window.dispatchEvent(new CustomEvent('replay:learning-action', { detail: 'review_complete' })); }
    catch { setNotice('浏览器暂时无法保存复习进度，请检查存储空间后重试。'); }
  }
  return <div className="account-review"><LearningActivity enabled={ready && !!current} review /><span className="account-eyebrow">收藏复习 · 免费</span><h1>再练一遍，记得更牢。</h1><p>先想想原句的意思，再翻看答案。收藏和复习进度保存在这台设备。</p>{notice && <div role="status" className="account-inline-note">{notice}</div>}
    {!ready ? <div className="account-card" role="status">正在读取本机收藏…</div> : current ? <section className="account-card account-flashcard">
      <div className="account-card-counter">{index + 1} / {cards.length}<VocabularyMotionToggle /></div>
      <VocabularyFlipCard key={identity(current)} flipped={answer} onFlip={setAnswer} label={current.word || current.sentence} answerLabel={`${current.sentence || current.word}。${current.translation || '这条收藏还没有译文'}`}
        front={<><span className="vocab-flip-label">先回忆，再翻面</span><h2>{current.word}</h2>{current.sentence !== current.word && <p className="account-review-sentence" lang="en">{current.sentence}</p>}</>}
        back={<><span className="vocab-flip-label">原句与释义 / 译文</span><p className="account-review-sentence vocab-original-sentence" lang="en">{current.sentence || current.word}</p><p className="account-review-answer vocab-answer-translation">{current.translation || '这条收藏还没有译文，可以回到学习台补充。'}</p></>} />
      <div className="account-original-actions"><SavedLineReplay key={identity(current)} word={current} /><button type="button" className="account-text-link" onClick={() => { stopOriginalLinePlayback(); speak(current.word || current.sentence); }}>听单词发音 🔊</button></div>
      {answer ? <div className="account-button-row"><button type="button" className="btn btn-secondary" onClick={() => finish(false)}>还不熟，稍后再练</button><button type="button" className="btn btn-primary" onClick={() => finish(true)}>记住了，下一句</button></div> : <button type="button" className="btn btn-primary account-full-button" onClick={() => setAnswer(true)}>翻看释义</button>}
    </section> : <section className="account-card account-flashcard"><h2>{cards.length ? '这轮复习完成了。' : '今天没有待复习的收藏。'}</h2><p>{cards.length ? `已复习 ${cards.length} 个表达，下次按复习时间继续。` : '去学习台收藏几个词和句子，回来就能练。已有收藏按计划到期后会出现在这里。'}</p><a href="/learn" className="btn btn-primary">回学习台</a></section>}
    <a href="/account" className="account-text-link">← 返回我的学习</a></div>;
}
