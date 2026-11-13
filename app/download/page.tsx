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

  const setup = <>
    <ol className="grid gap-4 sm:grid-cols-3">
      {[
        ['下载组件', 'Windows 版已配好运行环境，只需下载一次。'],
        ['解压并启动', '解压后双击「启动 Replay 下载组件.bat」。'],
        ['粘贴链接下载', '保持组件运行，在下方粘贴视频链接。'],
      ].map(([title, detail], index) => <li key={title} className="flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-sm">{index + 1}</span>
        <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-[var(--text-dim)]">{detail}</p></div>
      </li>)}
    </ol>
    <div className="mt-5 flex flex-wrap gap-3">
      <a className="btn btn-primary !min-h-[44px]" href={COMPONENT_DOWNLOAD}>下载 Windows 组件</a>
      {connection !== 'connected' && <button type="button" onClick={() => connectFrame()} disabled={busy || connection === 'connecting'} className="btn btn-ghost !min-h-[44px]">{connection === 'connecting' ? '连接中…' : '已启动，重新连接'}</button>}
      <a className="btn btn-ghost !min-h-[44px]" href={COMPONENT_GUIDE} target="_blank" rel="noreferrer">使用说明 / 其他系统</a>
    </div>
    <p className="mt-3 text-[12px] leading-6 text-[var(--text-faint)]">Windows 10 / 11（64 位）· 推荐 Chrome / Edge · 电脑重启后需再次启动组件</p>
  </>;

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-7 sm:px-6 sm:py-10">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-dim)]">
        <span className="rounded-full border border-[var(--line)] px-2.5 py-1">可选拓展 · 开源 · 本地下载</span>
        <span role="status" aria-live="polite">{connection === 'connected' ? '下载组件已连接' : connection === 'connecting' ? '正在检测下载组件…' : '下载组件尚未启动'}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">只有链接？这里一键下载视频！</h1>
          <p className="mt-3 max-w-[740px] text-sm leading-7 text-[var(--text-dim)]">剧说英语的可选拓展功能：下载支持来源的视频、电影等内容，可单独保存，也能分离字幕后导入学习。</p>
        </div>
        <div><button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-ghost !min-h-[44px]">导入已有 MP4 / SRT</button><p className="mt-2 text-xs text-[var(--text-faint)]">已有文件可直接学习，无需组件</p></div>
      </div>

      {connection === 'connected' ? <details className="mt-5 rounded-xl border border-[var(--line)] p-4 text-sm" aria-label="下载组件使用指引">
        <summary className="cursor-pointer text-[var(--text-dim)]">组件下载与使用说明</summary><div className="mt-5">{setup}</div>
      </details> : <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-7" aria-label="下载组件使用指引">
        <h2 className="mb-5 text-lg font-semibold">首次使用：先下载并启动本地组件</h2>{setup}
      </section>}

      {message && <p role="status" aria-live="polite" className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm leading-6">{message}</p>}

      <section className="mt-6" aria-label="内置视频下载器" aria-busy={connection === 'connecting'}>
        {frameUrl && <iframe ref={frameRef} title="剧说英语内置视频下载器" src={frameUrl} {...{ credentialless: '' }}
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
      <p className="mt-5 text-xs leading-6 text-[var(--text-faint)]">视频与字幕保存在本机，不上传到剧说英语。支持分离文本软字幕；硬字幕和图片字幕暂不能直接转为 SRT。</p>
    </main>
  );
}

export default function DownloadPage() {
  return <Suspense fallback={<main className="p-8">正在加载下载页…</main>}><DownloadInner /></Suspense>;
}
