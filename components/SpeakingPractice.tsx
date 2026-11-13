'use client';

import { useEffect, useRef, useState } from 'react';
import type { Cue } from '@/lib/types';

type Recording = { url: string; name: string; sentence: string; seconds: number };
type Phase = 'idle' | 'requesting' | 'recording' | 'saving';
const MAX_SECONDS = 120;
const elapsedLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function microphoneError(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '麦克风权限未开启。请在浏览器的网站权限中允许麦克风，再重试。';
  if (name === 'NotFoundError') return '没有找到麦克风，请连接麦克风后重试。';
  if (name === 'NotReadableError') return '麦克风暂时无法使用，可能被其他应用占用。关闭占用后重试。';
  return '录音未能开始，请用最新版 Safari、Chrome 或 Edge 重试。';
}

export default function SpeakingPractice({ cue, cueNumber, onListen, onPause }: {
  cue?: Cue; cueNumber: number; onListen: (cue: Cue) => void; onPause: () => void;
}) {
  const [open, setOpen] = useState(false), [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [recording, setRecording] = useState<Recording>();
  const recorder = useRef<MediaRecorder>(), stream = useRef<MediaStream>(), audio = useRef<HTMLAudioElement>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(), url = useRef<string>(), generation = useRef(0);
  const busy = phase !== 'idle';
  const stopRef = useRef<() => void>(() => {});
  stopRef.current = () => { if (recorder.current?.state === 'recording') { setPhase('saving'); recorder.current.stop(); } };

  useEffect(() => {
    const stopWhenHidden = () => { if (document.visibilityState === 'hidden') { generation.current++; stopRef.current(); audio.current?.pause(); stream.current?.getTracks().forEach(track => track.stop()); setPhase(value => value === 'requesting' ? 'idle' : value); } };
    const stopVideo = (event: Event) => { if (event.target instanceof HTMLVideoElement) { if (recorder.current?.state === 'recording') event.target.pause(); else audio.current?.pause(); } };
    document.addEventListener('visibilitychange', stopWhenHidden); document.addEventListener('play', stopVideo, true);
    return () => {
      generation.current++; document.removeEventListener('visibilitychange', stopWhenHidden); document.removeEventListener('play', stopVideo, true);
      if (timer.current) clearInterval(timer.current);
      if (recorder.current) { recorder.current.onstop = null; recorder.current.ondataavailable = null; recorder.current.onerror = null; if (recorder.current.state !== 'inactive') recorder.current.stop(); }
      stream.current?.getTracks().forEach(track => track.stop()); if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

  async function start() {
    if (busy || !cue) return;
    setError(''); setNotice('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音。请用 Safari、Chrome 或 Edge 打开 HTTPS 网站，或在 localhost 上使用。'); return;
    }
    const requestId = ++generation.current;
    const sentence = cue.text, name = `剧说英语-第${cueNumber}句`;
    onPause(); audio.current?.pause(); setPhase('requesting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (requestId !== generation.current || document.visibilityState !== 'visible') { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = []; let size = 0; const started = performance.now();
      recorder.current = capture;
      capture.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); size += event.data.size; if (size >= 8 * 1024 * 1024) stopRef.current(); } };
      capture.onerror = () => { setError('录音中断，请检查麦克风后重录。'); stopRef.current(); media.getTracks().forEach(track => track.stop()); };
      capture.onstop = () => {
        if (timer.current) clearInterval(timer.current);
        media.getTracks().forEach(track => track.stop()); stream.current = undefined; recorder.current = undefined;
        const type = capture.mimeType || mime || chunks[0]?.type || 'audio/webm';
        const blob = new Blob(chunks, { type });
        if (blob.size) {
          const next = URL.createObjectURL(blob); if (url.current) URL.revokeObjectURL(url.current); url.current = next;
          const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          setRecording({ url: next, name: `${name}.${extension}`, sentence, seconds: Math.max(1, Math.round((performance.now() - started) / 1000)) });
        } else setError('没有录到声音，请检查麦克风后重试。');
        setPhase('idle');
      };
      media.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (capture.state === 'recording') { setNotice('麦克风已断开，已保留本次录音。'); stopRef.current(); } }, { once: true }));
      capture.start(1000); onPause(); setSeconds(0); setPhase('recording');
      timer.current = setInterval(() => {
        const elapsed = Math.floor((performance.now() - started) / 1000); setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) { setNotice('已达到 2 分钟，录音自动停止。'); stopRef.current(); }
      }, 250);
    } catch (issue) {
      stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined;
      if (requestId === generation.current) { setPhase('idle'); setError(microphoneError(issue)); }
    }
  }
  function clearRecording() {
    audio.current?.pause(); if (url.current) URL.revokeObjectURL(url.current); url.current = undefined; setRecording(undefined); setError('');
  }
  return <section className="speaking-practice" data-speaking-practice data-recording={phase === 'recording'} data-capturing={busy}>
    <button type="button" className="speaking-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
      {phase === 'recording' ? `正在录音 ${elapsedLabel(seconds)}` : phase === 'requesting' ? '等待麦克风授权…' : phase === 'saving' ? '正在保存录音…' : '录音跟读 · 练口语'} <span>{open ? '收起' : '展开'}</span>
    </button>
    <div className="speaking-panel" hidden={!open}>
      <p className="speaking-sentence" lang="en">{cue ? `第 ${cueNumber} 句：${cue.text}` : '先导入字幕或打开试学片段，再选择一句练口语。'}</p>
      <div className="speaking-actions">
        <button type="button" disabled={!cue || busy} onClick={() => { audio.current?.pause(); if (cue) onListen(cue); }}>听原句</button>
        {phase === 'recording' ? <button type="button" className="speaking-stop" onClick={() => stopRef.current()}>停止录音 · {elapsedLabel(seconds)}</button> : <button type="button" className="speaking-record" disabled={!cue || busy} onClick={() => void start()}>{phase === 'requesting' ? '等待麦克风授权…' : phase === 'saving' ? '正在保存…' : recording ? '重新录音' : '开始录音'}</button>}
      </div>
      {recording && <div className="speaking-recording"><p>我的录音 · {elapsedLabel(recording.seconds)}<span lang="en">{recording.sentence}</span></p><audio ref={audio} key={recording.url} src={recording.url} controls preload="metadata" aria-label="回放我的跟读录音" onPlay={() => { if (busy) audio.current?.pause(); onPause(); }} onError={() => setError('浏览器无法回放这次录音，可以下载后用系统播放器打开。')} />
        <div className="speaking-links"><a href={recording.url} download={recording.name} onClick={event => { if (busy) event.preventDefault(); }}>下载录音</a><button type="button" onClick={clearRecording} disabled={busy}>删除录音</button></div></div>}
      {error && <p className="speaking-error" role="alert">{error}</p>}{notice && <p className="speaking-note" role="status">{notice}</p>}
      <p className="speaking-note" role={phase === 'recording' ? 'status' : undefined}>{phase === 'recording' ? '正在使用麦克风，切到后台会自动停止。' : '听原句 → 录音跟读 → 回放对比。录音不上传，离开或刷新前可下载保存。'}</p>
    </div>
  </section>;
}
