'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { COMPANION_ORIGIN, isCompanionMessage, saveDownloadImport, validImportToken, validateDownloadBundle } from '@/lib/download-import';

function DownloadInner() {
  const params = useSearchParams();
  const receiving = validImportToken(params.get('receive')) && params.get('tool') === COMPANION_ORIGIN;
  const [message, setMessage] = useState<string>();
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [busy, setBusy] = useState(false);
  const [frameUrl, setFrameUrl] = useState<string>();
  const [frameHeight, setFrameHeight] = useState(620);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameTokenRef = useRef('');
  const sourceRef = useRef<Window | null>(null);
  const tokenRef = useRef('');
  const handlingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const fileRef = useRef<HTMLInputElement>(null);

  async function receiveBundle(value: unknown, sender?: Window, token?: string) {
    if (handlingRef.current) return;
    handlingRef.current = true;
    setBusy(true);
    setMessage('正在把视频与字幕送入学习台，文件留在当前浏览器。');
    try {
      const bundle = validateDownloadBundle(value);
      const id = await saveDownloadImport(bundle);
      sender?.postMessage({ type: 'replay:imported', token }, COMPANION_ORIGIN);
      // The isolated learning document must load afresh after the receiver.
      window.location.assign(`/learn?download=${encodeURIComponent(id)}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '导入失败，请保存 MP4 与 SRT 后手动导入。';
      setMessage(detail);
      sender?.postMessage({ type: 'replay:import-error', token, message: detail }, COMPANION_ORIGIN);
      handlingRef.current = false;
      setBusy(false);
    }
  }

  function connectFrame() {
    clearTimeout(timerRef.current);
    const token = crypto.randomUUID();
    frameTokenRef.current = token;
    setConnection('connecting');
    const query = new URLSearchParams({ embed: '1', replay: window.location.origin, token,
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' });
    // Existing companion services already serve index.html; credentialless
    // embedding also works before their next backend restart.
    setFrameUrl(`${COMPANION_ORIGIN}/index.html?${query}`);
    timerRef.current = setTimeout(() => setConnection('offline'), 8000);
  }

  function syncFrame() {
    const target = frameRef.current?.contentWindow;
    if (!target) return;
    target.postMessage({ type: 'replay:connect', token: frameTokenRef.current }, COMPANION_ORIGIN);
    target.postMessage({ type: 'replay:theme', token: frameTokenRef.current,
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' }, COMPANION_ORIGIN);
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const fromFrame = isCompanionMessage(event, frameRef.current?.contentWindow ?? null, frameTokenRef.current);
      const fromOpener = isCompanionMessage(event, sourceRef.current, tokenRef.current);
      if (!fromFrame && !fromOpener) return;
      if (event.data.type === 'replay:ready') {
        clearTimeout(timerRef.current);
        setConnection('connected');
      } else if (event.data.type === 'replay:height' && fromFrame) {
        const height = event.data.height;
        if (typeof height === 'number' && Number.isFinite(height)) {
          setFrameHeight(Math.min(30_000, Math.max(320, Math.ceil(height))));
        }
      } else if (event.data.type === 'replay:files') {
        clearTimeout(timerRef.current);
        void receiveBundle(event.data.bundle, event.source as Window, event.data.token);
      }
    };
    window.addEventListener('message', onMessage);
    const token = params.get('receive');
    if (receiving && validImportToken(token) && window.opener) {
      sourceRef.current = window.opener;
      tokenRef.current = token;
      setConnection('connected');
      setMessage('正在接收视频与配套字幕…');
      sourceRef.current?.postMessage({ type: 'replay:receiver-ready', token }, COMPANION_ORIGIN);
    } else {
      connectFrame();
    }
    const observer = new MutationObserver(syncFrame);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      clearTimeout(timerRef.current);
      observer.disconnect();
      window.removeEventListener('message', onMessage);
    };
  }, [params, receiving]);

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-7 sm:px-6 sm:py-10">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-dim)]">
        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">视频与字幕留在本机</span>
        <span role="status" aria-live="polite">{connection === 'connected' ? '已连接电脑下载服务' : connection === 'connecting' ? '正在连接电脑下载服务…' : '电脑下载服务尚未连接'}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">下载视频，直接开始学习</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">在这里粘贴链接、下载视频并分离 SRT，完成后一起导入学习台。</p>
        </div>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-ghost !min-h-[44px]">导入已有 MP4 / SRT</button>
      </div>

      {message && <p role="status" aria-live="polite" className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm leading-6">{message}</p>}

      <section className="mt-6" aria-label="内置视频下载器" aria-busy={connection === 'connecting'}>
        {connection !== 'connected' && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8">
            <h2 className="font-semibold">{connection === 'connecting' ? '正在加载下载工具…' : '先启动电脑上的下载服务'}</h2>
            <p className="mt-3 max-w-[720px] text-sm leading-7 text-[var(--text-dim)]">{connection === 'connecting'
              ? '连接后，链接输入框和下载记录会直接显示在本页。'
              : '运行字幕版下载器的启动脚本，然后点击「重新连接」。如果服务已经运行，请更新到支持网页内置的新版本。'}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={connectFrame} disabled={busy || connection === 'connecting'} className="btn btn-primary !min-h-[44px]">重新连接</button>
              <a className="btn btn-ghost !min-h-[44px]" href="https://github.com/3121597355/replay/tree/main/services/video-downloader" target="_blank" rel="noreferrer">安装与启动说明</a>
            </div>
          </div>
        )}
        {frameUrl && <iframe ref={frameRef} title="Replay 内置视频下载器" src={frameUrl} {...{ credentialless: '' }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
          allow="clipboard-read; clipboard-write" onLoad={syncFrame}
          className="w-full border-0" style={{ height: frameHeight, display: connection === 'connected' ? 'block' : 'none' }} />}
      </section>

      <input ref={fileRef} type="file" accept=".mp4,.srt" multiple hidden aria-label="选择配套视频与字幕" onChange={event => {
        const files = Array.from(event.target.files || []);
        const videos = files.filter(file => /\.mp4$/i.test(file.name));
        if (videos.length !== 1) { setMessage('请选择一份 MP4 和它对应的 SRT。'); return; }
        void receiveBundle({ video: videos[0], subtitles: files.filter(file => /\.srt$/i.test(file.name)) });
        event.target.value = '';
      }} />
      <p className="mt-6 text-[13px] leading-6 text-[var(--text-faint)]">下载由电脑上的服务处理，操作留在这个页面。手机可导入已有视频和字幕；画面中的硬字幕、图片字幕无法直接分离成 SRT。</p>
    </main>
  );
}

export default function DownloadPage() {
  return <Suspense fallback={<main className="p-8">正在加载下载页…</main>}><DownloadInner /></Suspense>;
}
