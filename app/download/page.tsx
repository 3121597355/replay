'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { COMPANION_ORIGIN, isCompanionMessage, saveDownloadImport, validImportToken, validateDownloadBundle } from '@/lib/download-import';

const COMPONENT_DOWNLOAD = 'https://github.com/3121597355/replay/releases/download/downloader-v0.2.0/Replay-Download-Component-v0.2.0-windows-x64.zip';
const COMPONENT_GUIDE = 'https://github.com/3121597355/replay/tree/main/services/video-downloader#第一次使用';

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

  function connectFrame(silent = false) {
    clearTimeout(timerRef.current);
    const token = crypto.randomUUID();
    frameTokenRef.current = token;
    if (!silent) setConnection('connecting');
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

  useEffect(() => {
    if (connection !== 'offline' || busy) return;
    // Users can start the component while keeping this page open.
    const retry = () => { if (!document.hidden) connectFrame(true); };
    const interval = setInterval(retry, 10_000);
    document.addEventListener('visibilitychange', retry);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [connection, busy]);

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-7 sm:px-6 sm:py-10">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-dim)]">
        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">开源 · 本地处理 · 视频不上传</span>
        <span role="status" aria-live="polite">{connection === 'connected' ? '下载组件已连接' : connection === 'connecting' ? '正在检测下载组件…' : '下载组件尚未启动'}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">下载视频，直接开始学习</h1>
          <p className="mt-3 max-w-[740px] text-sm leading-7 text-[var(--text-dim)]">首次使用下载功能，需要先下载并启动电脑上的 Replay 下载组件。启动后，网站会自动连接；粘贴链接、下载视频、分离字幕和导入学习都在这里完成。</p>
        </div>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-ghost !min-h-[44px]">导入已有 MP4 / SRT</button>
      </div>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-7" aria-label="下载组件使用指引">
        {connection === 'connected' ? (
          <>
            <h2 className="font-semibold">下载组件已就绪，可以在下方直接下载</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">组件在电脑后台运行，无需打开独立工具页面。视频与字幕保存在你的电脑，下载与导入不经过 Replay 服务器。</p>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-[var(--text-dim)]">查看首次使用步骤与组件下载</summary>
              <p className="mt-3 leading-7 text-[var(--text-dim)]">下载 Windows 组件 → 解压全部文件 → 双击「启动 Replay 下载组件.bat」→ 回到本页。电脑重启后，再双击启动组件即可。</p>
              <a className="btn btn-ghost mt-3 !min-h-[44px]" href={COMPONENT_DOWNLOAD}>下载 Windows 组件</a>
            </details>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">第一次使用？先下载并启动组件</h2>
            <ol className="mt-5 grid gap-5 sm:grid-cols-3">
              {[
                ['下载组件', '只需下载一次，运行环境已配好，无需另装开发工具。'],
                ['解压并双击启动', '解压全部文件，再双击「启动 Replay 下载组件.bat」。'],
                ['回到网站开始下载', '保持组件运行，网站会自动连接，在下方粘贴链接即可。'],
              ].map(([title, detail], index) => (
                <li key={title} className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-sm font-semibold">{index + 1}</span>
                  <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-[var(--text-dim)]">{detail}</p></div>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap gap-3">
              <a className="btn btn-primary !min-h-[44px]" href={COMPONENT_DOWNLOAD}>下载 Windows 组件</a>
              <button type="button" onClick={() => connectFrame()} disabled={busy || connection === 'connecting'} className="btn btn-ghost !min-h-[44px]">{connection === 'connecting' ? '正在检测组件…' : '已启动，重新连接'}</button>
              <a className="btn btn-ghost !min-h-[44px]" href={COMPONENT_GUIDE} target="_blank" rel="noreferrer">使用说明 / 其他系统</a>
            </div>
            <p className="mt-4 text-[13px] leading-6 text-[var(--text-faint)]">适用于 Windows 10 / 11（64 位），推荐最新版 Chrome 或 Edge。下载后需手动启动一次；电脑重启后再次启动。视频与字幕留在本机。</p>
          </>
        )}
      </section>

      {message && <p role="status" aria-live="polite" className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm leading-6">{message}</p>}

      <section className="mt-6" aria-label="内置视频下载器" aria-busy={connection === 'connecting'}>
        {connection !== 'connected' && <p role="status" className="text-sm leading-6 text-[var(--text-dim)]">{connection === 'connecting' ? '正在检测电脑上的组件，连接后会在这里显示下载器…' : '组件尚未连接。启动后本页会自动重试，也可以点击上方「已启动，重新连接」。'}</p>}
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
      <p className="mt-6 text-[13px] leading-6 text-[var(--text-faint)]">组件负责在电脑上下载和分离字幕，操作留在这个页面。已有 MP4 / SRT 可直接导入，无需组件；手机也可导入已有文件。画面中的硬字幕、图片字幕无法直接分离成 SRT。</p>
    </main>
  );
}

export default function DownloadPage() {
  return <Suspense fallback={<main className="p-8">正在加载下载页…</main>}><DownloadInner /></Suspense>;
}
