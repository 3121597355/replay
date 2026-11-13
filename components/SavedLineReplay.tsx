'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedLineClip, SavedWord } from '@/lib/types';
import { getStorageOwner } from '@/lib/account-storage';
import { learningStore } from '@/lib/learning-session';
import { legacySavedClip, sameSavedVideo, validSavedClip } from '@/lib/saved-line';
import { savedMediaStore } from '@/lib/saved-media';
import { loadSavedWords, persistSavedWords } from '@/lib/saved-words';
import { formatTime } from '@/lib/srt';
import { isAudioSource, MEDIA_ACCEPT } from '@/lib/media';

export const stopOriginalLinePlayback = () => window.dispatchEvent(new Event('replay:stop-original-line'));
type Material = { clip: SavedLineClip; url: string; owned: boolean };
export default function SavedLineReplay({ word }: { word: SavedWord }) {
  const owner = getStorageOwner();
  const video = useRef<HTMLMediaElement | null>(null), picker = useRef<HTMLInputElement>(null), generation = useRef(0);
  const attachPlayer = useCallback((player: HTMLMediaElement | null) => { video.current = player; }, []);
  const [material, setMaterial] = useState<Material>(), [missing, setMissing] = useState<SavedLineClip>();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [playing, setPlaying] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const audioOnly = material?.clip.source.kind === 'file' && isAudioSource(material.clip.source);
  const Player = audioOnly ? 'audio' : 'video';
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { const player = video.current; return () => { player?.pause(); if (material?.owned) URL.revokeObjectURL(material.url); }; }, [material]);
  useEffect(() => {
    if (!open) return;
    const pause = () => video.current?.pause();
    const hide = () => { if (document.visibilityState !== 'visible') pause(); };
    window.addEventListener('replay:stop-original-line', pause); window.addEventListener('pagehide', pause); document.addEventListener('visibilitychange', hide);
    return () => { pause(); window.removeEventListener('replay:stop-original-line', pause); window.removeEventListener('pagehide', pause); document.removeEventListener('visibilitychange', hide); };
  }, [open]);
  const stopAtEnd = useCallback(() => {
    const player = video.current;
    if (player && material && player.currentTime >= material.clip.end) { player.pause(); if (Math.abs(player.currentTime - material.clip.end) > .01) player.currentTime = material.clip.end; }
  }, [material]);
  useEffect(() => {
    if (!playing || !material) return;
    let frame: number;
    const tick = () => { stopAtEnd(); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, material, stopAtEnd]);
  function replay() {
    const player = video.current;
    if (!player || !material || player.readyState < 1) return;
    if (!Number.isFinite(player.duration) || material.clip.end > player.duration + .05) { player.pause(); setError('原句时间超出这份素材，请在学习台确认素材和字幕后重新收藏。'); return; }
    setError(''); player.currentTime = material.clip.start;
    void player.play().catch(issue => { if (issue.name !== 'AbortError') setError('播放未能开始，请再点一次播放；也可换用 MP4 视频或 MP3/M4A 音频。'); });
  }
  function link(clip: SavedLineClip) {
    const words = loadSavedWords(owner);
    const index = words.findIndex(item => item.addedAt === word.addedAt && item.word === word.word && item.sentence === word.sentence);
    if (index >= 0) { words[index] = { ...words[index], clip }; if (persistSavedWords(words, owner)) window.dispatchEvent(new CustomEvent('replay:saved-words-updated', { detail: owner })); }
  }
  function show(clip: SavedLineClip, file?: File) {
    const url = file ? URL.createObjectURL(file) : clip.source.kind === 'sample' ? clip.source.video : '';
    if (!url) return;
    setMissing(undefined); setMaterial({ clip, url, owned: !!file }); link(clip);
    const request = generation.current;
    if (file) void savedMediaStore(owner).save(clip, file).then(saved => { if (!saved && request === generation.current) setNotice('回放缓存未能保存在浏览器中，下次可重新选择原片。'); });
  }
  async function load() {
    const request = ++generation.current;
    setOpen(true); setBusy(true); setError(''); setNotice('');
    try {
      let clip = validSavedClip(word.clip) ? word.clip : undefined;
      let file = clip?.source.kind === 'file' ? await savedMediaStore(owner).read(clip).catch(() => undefined) : undefined;
      if (!clip || (clip.source.kind === 'file' && !file)) {
        const latest = await learningStore(owner).loadLearningSession().catch(() => null);
        clip = clip || legacySavedClip(word, latest?.session || null);
        if (clip && latest?.video && sameSavedVideo(clip, latest.video)) file = latest.video;
      }
      if (request !== generation.current) return;
      if (!clip) { setError('这条旧收藏没有原句时间点，当前素材也无法唯一匹配。请回学习台重新收藏这句原文。'); return; }
      if (clip.source.kind === 'file' && !file) { setMissing(clip); setError('本机没有这份原素材了，选择同一个视频或音频即可重放。'); return; }
      show(clip, file);
    } catch { if (request === generation.current) setError('原句暂时无法读取，请稍后再试。'); }
    finally { if (request === generation.current) setBusy(false); }
  }
  function selectFile(file?: File) {
    if (!file || !missing) return;
    if (!sameSavedVideo(missing, file)) { setError(`请选择收藏对应的原素材：${missing.videoName}。当前文件与原素材不一致。`); return; }
    setError(''); show(missing, file);
  }
  return <div className="saved-line-replay" data-original-line>
    <button type="button" className="account-text-link" disabled={busy} onClick={() => material ? replay() : void load()}>{busy ? '正在读取原句…' : '▶ 播放原句'}</button>
    {open && <div className="saved-line-panel">
      <button type="button" className="saved-line-close" aria-label="收起原句播放器" onClick={() => { generation.current++; video.current?.pause(); setMaterial(undefined); setOpen(false); setBusy(false); }}>收起 ×</button>
      {material && <><Player key={material.url} ref={attachPlayer} src={material.url} controls playsInline preload="metadata" aria-label={`原句回放：${word.sentence}`} onLoadedMetadata={replay} onTimeUpdate={stopAtEnd} onPlay={() => {
        const player = video.current; if (!player) return;
        if (!Number.isFinite(player.duration) || material.clip.end > player.duration + .05) { player.pause(); setError('原句时间超出素材长度，请回学习台核对后重新收藏。'); return; }
        document.querySelectorAll<HTMLMediaElement>('video,audio').forEach(other => { if (other !== player) other.pause(); }); window.speechSynthesis?.cancel();
        if (player.currentTime < material.clip.start || player.currentTime >= material.clip.end) player.currentTime = material.clip.start;
        setPlaying(true);
      }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onSeeking={() => { if (video.current && video.current.currentTime < material.clip.start) video.current.currentTime = material.clip.start; stopAtEnd(); }} onError={() => { setPlaying(false); setError('浏览器无法播放这份素材，请在学习台换用 MP4 视频或 MP3/M4A 音频并重新收藏。'); }} />
        <p className="saved-line-source">{material.clip.videoName} · {formatTime(material.clip.start)}—{formatTime(material.clip.end)} · 句尾自动暂停</p></>}
      {error && <p className="saved-line-error" role="alert">{error}</p>}
      {missing && <><input ref={picker} type="file" accept={MEDIA_ACCEPT} hidden onChange={event => { selectFile(event.target.files?.[0]); event.target.value = ''; }} /><button type="button" className="btn btn-secondary" onClick={() => picker.current?.click()}>选择原素材</button></>}
      {!material && !missing && error && <a href="/learn" className="account-text-link">回学习台</a>}
      {notice && <p className="saved-line-source" role="status">{notice}</p>}
    </div>}
  </div>;
}
