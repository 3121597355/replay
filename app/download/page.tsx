'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { COMPANION_ORIGIN, isCompanionMessage, saveDownloadImport, validImportToken, validateDownloadBundle } from '@/lib/download-import';

function DownloadInner() {
  const params = useSearchParams();
  const [message, setMessage] = useState('在电脑上启动下载器，下载视频后点击「导入 Replay 学习」。');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const sourceRef = useRef<Window | null>(null);
  const tokenRef = useRef('');
  const handlingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const fileRef = useRef<HTMLInputElement>(null);

  async function receiveBundle(value: unknown) {
    if (handlingRef.current) return;
    handlingRef.current = true;
    setBusy(true);
    setMessage('正在把视频与字幕送入学习台，文件留在当前浏览器。');
    try {
      const bundle = validateDownloadBundle(value);
      const id = await saveDownloadImport(bundle);
      sourceRef.current?.postMessage({ type: 'replay:imported', token: tokenRef.current }, COMPANION_ORIGIN);
      // A full navigation restores the learning player's cross-origin isolation.
      window.location.assign(`/learn?download=${encodeURIComponent(id)}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '导入失败，请保存 MP4 与 SRT 后手动导入。';
      setMessage(detail);
      sourceRef.current?.postMessage({ type: 'replay:import-error', token: tokenRef.current, message: detail }, COMPANION_ORIGIN);
      handlingRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isCompanionMessage(event, sourceRef.current, tokenRef.current)) return;
      if (event.data.type === 'replay:ready') {
        clearTimeout(timerRef.current);
        setConnected(true);
        setMessage('下载器已连接。下载完成后，在下载记录中点击「导入 Replay 学习」。');
      } else if (event.data.type === 'replay:files') {
        clearTimeout(timerRef.current);
        void receiveBundle(event.data.bundle);
      }
    };
    window.addEventListener('message', onMessage);
    const receiving = params.get('receive');
    if (validImportToken(receiving) && window.opener && params.get('tool') === COMPANION_ORIGIN) {
      sourceRef.current = window.opener;
      tokenRef.current = receiving;
      setConnected(true);
      setMessage('正在接收下载器中的视频与字幕…');
      sourceRef.current?.postMessage({ type: 'replay:receiver-ready', token: receiving }, COMPANION_ORIGIN);
    }
    return () => {
      clearTimeout(timerRef.current);
      window.removeEventListener('message', onMessage);
    };
  }, [params]); // The receiver stays on this page until a verified bundle is saved.

  function connect() {
    const token = crypto.randomUUID();
    tokenRef.current = token;
    sourceRef.current = window.open(`${COMPANION_ORIGIN}/?replay=${encodeURIComponent(window.location.origin)}&token=${token}`, `replay-downloader-${token}`);
    if (!sourceRef.current) {
      setMessage('浏览器拦截了下载器窗口，请允许本页打开新窗口后重试。');
      return;
    }
    setConnected(false);
    setMessage('正在连接电脑上的下载器…');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setMessage('下载器尚未连接。请先启动字幕版桌面工具，再点击「打开电脑下载器」。');
    }, 12_000);
  }

  return (
    <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-5 flex items-center gap-2 text-[13px] text-[var(--text-dim)]">
        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">电脑下载工具</span>
        <span>视频与字幕留在本机</span>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">下载一段，开始精听</h1>
      <p className="mt-4 max-w-[660px] leading-7 text-[var(--text-dim)]">把下载器生成的 MP4 和配套 SRT 一起送到 Replay，直接播放、逐句学习。支持文本软字幕分离。</p>

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-7" aria-label="下载与导入">
        <ol className="grid gap-5 text-sm sm:grid-cols-3">
          {['启动电脑下载器', '下载视频并分离 SRT', '一键导入学习台'].map((label, index) => (
            <li key={label} className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--page)] font-semibold">{index + 1}</span>{label}
            </li>
          ))}
        </ol>
        <div className="mt-7 flex flex-wrap gap-3">
          <button type="button" onClick={connect} disabled={busy} className="btn btn-primary !min-h-[44px]">{connected ? '重新打开下载器' : '打开电脑下载器'}</button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-ghost !min-h-[44px]">导入已下载的 MP4 / SRT</button>
        </div>
        <input ref={fileRef} type="file" accept=".mp4,.srt" multiple hidden aria-label="选择配套视频与字幕" onChange={event => {
          const files = Array.from(event.target.files || []);
          const videos = files.filter(file => /\.mp4$/i.test(file.name));
          if (videos.length !== 1) { setMessage('请选择一份 MP4 和它对应的 SRT。'); return; }
          void receiveBundle({ video: videos[0], subtitles: files.filter(file => /\.srt$/i.test(file.name)) });
          event.target.value = '';
        }} />
        <p className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--page)] px-4 py-3 text-sm leading-6 text-[var(--text-soft)]" role="status" aria-live="polite">{message}</p>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-[var(--line)] p-5">
          <h2 className="font-semibold">第一次使用</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">请先在电脑上安装并启动字幕版下载器，连接完成后继续操作。</p>
          <a className="mt-3 inline-block text-sm text-[var(--link)] underline underline-offset-4" href="https://github.com/3121597355/replay/tree/main/services/video-downloader" target="_blank" rel="noreferrer">查看桌面工具与启动说明</a>
        </section>
        <section className="rounded-xl border border-[var(--line)] p-5">
          <h2 className="font-semibold">在手机上学习</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">当前下载需要电脑上的工具。把 MP4 和 SRT 传到手机后，可从这里一起导入，也可在学习台分别选择文件。</p>
          <a className="mt-3 inline-block text-sm text-[var(--link)] underline underline-offset-4" href="/learn">打开学习台</a>
        </section>
      </div>
      <p className="mt-6 text-[13px] leading-6 text-[var(--text-faint)]">画面中的硬字幕、图片字幕无法直接分离成 SRT。请使用你有权下载和学习的视频；没有文本字幕时也可以先导入视频。</p>
    </main>
  );
}

export default function DownloadPage() {
  return <Suspense fallback={<main className="p-8">正在打开下载工具…</main>}><DownloadInner /></Suspense>;
}
