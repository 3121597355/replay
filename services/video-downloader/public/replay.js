const DEFAULT_REPLAY = 'https://www.replayen.com';
const ALLOWED_ORIGINS = new Set([
  DEFAULT_REPLAY, 'https://replayen.com', 'https://replay-henna.vercel.app',
  'http://localhost:4310', 'http://127.0.0.1:4310',
  'http://localhost:4311', 'http://127.0.0.1:4311',
]);
const MAX_BYTES = 500 * 1024 * 1024;
const params = new URLSearchParams(window.location.search);
const pairedOrigin = params.get('replay');
const pairedToken = params.get('token');
const paired = ALLOWED_ORIGINS.has(pairedOrigin) && /^[a-f\d-]{32,64}$/i.test(pairedToken || '') && window.opener;
const replayOrigin = ALLOWED_ORIGINS.has(pairedOrigin) ? pairedOrigin : DEFAULT_REPLAY;
let sending = false;

export function announceReplay() {
  const returnLink = document.querySelector('#returnReplayLink');
  if (returnLink) returnLink.href = `${replayOrigin}/learn`;
  if (paired) window.opener.postMessage({ type: 'replay:ready', token: pairedToken }, pairedOrigin);
}

async function readLocalFile(url, name, type, signal) {
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin || !target.pathname.startsWith('/api/files/')) throw new Error('文件地址无效。');
  const response = await fetch(target, { signal });
  if (!response.ok) throw new Error('下载文件已不存在，请重新下载。');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('视频过大，请使用更小的片段。');
  const blob = await response.blob();
  if (blob.size > MAX_BYTES) throw new Error('文件超过容量限制。');
  return new File([blob], name, { type });
}

export async function sendToReplay(task, button) {
  if (sending) throw new Error('正在导入另一段视频，请稍候。');
  sending = true;
  button.disabled = true;
  button.textContent = '正在送入 Replay…';
  const targetOrigin = paired ? pairedOrigin : DEFAULT_REPLAY;
  const token = paired ? pairedToken : crypto.randomUUID();
  const controller = new AbortController();
  let target = paired ? window.opener : null;
  let bundle, ready = !!paired, sent = false, timer;
  try {
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        controller.abort();
        error ? reject(error) : resolve();
      };
      const send = () => {
        if (ready && bundle && target && !sent) {
          sent = true;
          target.postMessage({ type: 'replay:files', token, bundle }, targetOrigin);
        }
      };
      const onMessage = event => {
        if (event.origin !== targetOrigin || event.source !== target || event.data?.token !== token) return;
        if (event.data.type === 'replay:receiver-ready') { ready = true; send(); }
        if (event.data.type === 'replay:imported') finish();
        if (event.data.type === 'replay:import-error') finish(new Error(event.data.message || 'Replay 导入失败。'));
      };
      window.addEventListener('message', onMessage);
      if (!target || target.closed) {
        ready = false;
        target = window.open(`${targetOrigin}/download?receive=${token}&tool=${encodeURIComponent(window.location.origin)}`, `replay-import-${token}`);
      }
      if (!target) { finish(new Error('请允许打开 Replay 窗口，然后重试。')); return; }
      timer = setTimeout(() => finish(new Error('Replay 接收超时，请从 Replay 下载页重新连接，或保存文件后手动导入。')), 60_000);
      void (async () => {
        const video = await readLocalFile(task.fileUrl, task.filename, 'video/mp4', controller.signal);
        const subtitles = [];
        let total = video.size;
        for (const file of (task.subtitles || []).filter(file => file.fileAvailable && file.fileUrl)) {
          const subtitle = await readLocalFile(file.fileUrl, file.filename, 'application/x-subrip', controller.signal);
          total += subtitle.size;
          if (total > MAX_BYTES) throw new Error('这组文件超过 500 MiB，请使用更小的片段。');
          subtitles.push(subtitle);
        }
        bundle = { video, subtitles };
        send();
      })().catch(finish);
    });
    button.textContent = '已送入 Replay';
  } catch (error) {
    button.textContent = '导入 Replay 学习';
    throw error;
  } finally { button.disabled = false; sending = false; }
}
