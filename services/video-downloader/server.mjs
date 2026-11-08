import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createDownloadManager } from './lib/download.mjs';
import { findBrowserExecutable, resolveWithBrowser } from './lib/browser-resolve.mjs';
import { resolveMedia } from './lib/resolve.mjs';
import { resolveDownloadPath } from './lib/security.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(ROOT, 'downloads');
const DEFAULT_HISTORY_FILE = process.env.HISTORY_FILE || path.join(ROOT, 'data', 'download-history.json');
const DEFAULT_BROWSER_PROFILE_DIR = path.join(ROOT, 'data', 'browser-profile');
const DEFAULT_YTDLP_PATH = process.env.YTDLP_PATH || (process.platform === 'win32'
  ? path.join(ROOT, 'tools', 'yt-dlp.exe') : 'yt-dlp');
const DEFAULT_FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const JSON_LIMIT = 16 * 1024;
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 25;

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > JSON_LIMIT) {
        const error = new Error('Request body is too large.');
        error.code = 'BODY_TOO_LARGE';
        reject(error);
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (size > JSON_LIMIT) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error('Request body must be valid JSON.');
        error.code = 'INVALID_JSON';
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function canonicalHttpUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('请输入有效的视频链接。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('只支持不含账号信息的 HTTP 或 HTTPS 链接。');
  }
  return url.href;
}

function clientResult(sourceUrl, result) {
  return {
    sourceUrl,
    title: result.title,
    thumbnail: result.thumbnail,
    items: result.items.map((item) => ({
      id: item.id,
      title: item.title,
      duration: item.duration,
      format: item.format,
      resolution: item.resolution,
      thumbnail: item.thumbnail,
      resolver: item.resolver,
    })),
  };
}

function clientTask(task) {
  return {
    ...task,
    fileUrl: task.status === 'completed' && task.fileAvailable
      ? `/api/files/${encodeURIComponent(task.filename)}`
      : null,
  };
}

function defaultOpenDownloads(downloadsDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$ErrorActionPreference = \'Stop\'; Start-Process -FilePath $env:VIDEO_DOWNLOADER_PATH',
    ], {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, VIDEO_DOWNLOADER_PATH: downloadsDir },
    });
    child.once('error', reject);
    child.once('close', (code) => {
      code === 0 ? resolve() : reject(new Error(`Unable to open the downloads folder (exit code ${code}).`));
    });
  });
}

function serveStatic(response, publicDir, pathname) {
  let relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  if (!relative || relative.includes('\0')) relative = 'index.html';
  const root = path.resolve(publicDir);
  const filename = path.resolve(root, relative);
  const rel = path.relative(root, filename);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    sendError(response, 404, 'NOT_FOUND', '未找到该资源。');
    return;
  }
  fs.stat(filename, (error, stat) => {
    if (error || !stat.isFile()) {
      sendError(response, 404, 'NOT_FOUND', '未找到该资源。');
      return;
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache',
    });
    fs.createReadStream(filename).pipe(response);
  });
}

export function createServer({
  downloadsDir = DEFAULT_DOWNLOADS_DIR,
  publicDir = DEFAULT_PUBLIC_DIR,
  resolver,
  interactiveResolver = resolver,
  downloadManager,
  dependencies = { ytDlp: false, ffmpeg: false },
  openDownloads = () => defaultOpenDownloads(downloadsDir),
  logger = console,
} = {}) {
  const cache = new Map();

  function cacheSet(sourceUrl, result) {
    cache.delete(sourceUrl);
    cache.set(sourceUrl, { result, time: Date.now() });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  function cacheGet(sourceUrl) {
    const entry = cache.get(sourceUrl);
    if (!entry || Date.now() - entry.time > CACHE_TTL) {
      cache.delete(sourceUrl);
      return null;
    }
    return entry.result;
  }

  return http.createServer(async (request, response) => {
    // A loopback companion must reject DNS rebinding and cross-site requests.
    let host;
    try { host = new URL(`http://${request.headers.host}`).hostname; } catch {}
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
      sendError(response, 403, 'HOST_FORBIDDEN', '下载器只接受本机访问。');
      return;
    }
    if (request.headers.origin) {
      let origin;
      try { origin = new URL(request.headers.origin); } catch {}
      if (!origin || origin.origin !== `http://${request.headers.host}`) {
        sendError(response, 403, 'ORIGIN_FORBIDDEN', '此页面不能操作本机下载器。');
        return;
      }
    }
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const { pathname } = requestUrl;

    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        sendJson(response, 200, { ok: true, dependencies });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/resolve') {
        let body;
        try {
          body = await readJson(request);
        } catch (error) {
          sendError(response, error.code === 'BODY_TOO_LARGE' ? 413 : 400, error.code || 'INVALID_JSON', error.message);
          return;
        }
        if (!body.url) {
          sendError(response, 400, 'URL_REQUIRED', '请粘贴一个视频页面或媒体链接。');
          return;
        }
        let sourceUrl;
        try {
          sourceUrl = canonicalHttpUrl(body.url);
        } catch (error) {
          sendError(response, 400, 'INVALID_URL', error.message);
          return;
        }
        try {
          const result = await resolver(sourceUrl);
          cacheSet(sourceUrl, result);
          sendJson(response, 200, clientResult(sourceUrl, result));
        } catch (error) {
          const code = error.code === 'BROWSER_VERIFICATION_REQUIRED'
            ? error.code
            : 'RESOLVE_FAILED';
          sendError(response, 422, code, error.message || '没有找到可下载的视频。');
        }
        return;
      }

      if (request.method === 'POST' && pathname === '/api/browser-resolve') {
        let body;
        try {
          body = await readJson(request);
        } catch (error) {
          sendError(response, error.code === 'BODY_TOO_LARGE' ? 413 : 400, error.code || 'INVALID_JSON', error.message);
          return;
        }
        let sourceUrl;
        try {
          sourceUrl = canonicalHttpUrl(body.url);
        } catch (error) {
          sendError(response, 400, 'INVALID_URL', error.message);
          return;
        }
        try {
          const result = await interactiveResolver(sourceUrl);
          cacheSet(sourceUrl, result);
          sendJson(response, 200, clientResult(sourceUrl, result));
        } catch (error) {
          const code = error.code === 'BROWSER_VERIFICATION_TIMEOUT'
            ? error.code
            : 'RESOLVE_FAILED';
          const diagnostic = error.diagnostic ?? {};
          logger.warn?.('Browser resolve failed.', {
            code,
            sourceUrl,
            ...(diagnostic.url ? { finalUrl: String(diagnostic.url) } : {}),
            ...(diagnostic.title ? { title: String(diagnostic.title).slice(0, 200) } : {}),
            ...(Number.isFinite(diagnostic.iframeCount) ? { iframeCount: diagnostic.iframeCount } : {}),
          });
          const message = code === 'BROWSER_VERIFICATION_TIMEOUT'
            ? '浏览器验证未完成或已超时，请重试。'
            : error.message || '浏览器验证后仍未找到可下载的视频。';
          sendError(response, 422, code, message);
        }
        return;
      }

      if (request.method === 'GET' && pathname === '/api/downloads') {
        sendJson(response, 200, { items: downloadManager.list().map(clientTask) });
        return;
      }

      if (request.method === 'DELETE' && pathname === '/api/downloads') {
        downloadManager.clearHistory();
        response.writeHead(204);
        response.end();
        return;
      }

      const deleteTaskMatch = request.method === 'DELETE' && pathname.match(/^\/api\/downloads\/([^/]+)$/);
      if (deleteTaskMatch) {
        const removed = downloadManager.removeHistory(decodeURIComponent(deleteTaskMatch[1]));
        if (!removed) {
          sendError(response, 404, 'TASK_NOT_FOUND', '未找到可删除的下载记录。');
          return;
        }
        response.writeHead(204);
        response.end();
        return;
      }

      if (request.method === 'POST' && pathname === '/api/downloads') {
        let body;
        try {
          body = await readJson(request);
        } catch (error) {
          sendError(response, error.code === 'BODY_TOO_LARGE' ? 413 : 400, error.code || 'INVALID_JSON', error.message);
          return;
        }
        let sourceUrl;
        try {
          sourceUrl = canonicalHttpUrl(body.sourceUrl);
        } catch (error) {
          sendError(response, 400, 'INVALID_URL', error.message);
          return;
        }
        const resolved = cacheGet(sourceUrl);
        if (!resolved) {
          sendError(response, 409, 'RESOLVE_EXPIRED', '解析结果已过期，请重新解析链接。');
          return;
        }
        const item = resolved.items.find((candidate) => candidate.id === String(body.itemId ?? ''));
        if (!item) {
          sendError(response, 404, 'MEDIA_NOT_FOUND', '未找到这个视频，请重新解析。');
          return;
        }
        const task = downloadManager.create({ title: body.title || item.title, item });
        sendJson(response, 202, task);
        return;
      }

      const taskActionMatch = request.method === 'POST' && pathname.match(/^\/api\/downloads\/([^/]+)\/(pause|resume)$/);
      if (taskActionMatch) {
        const [, taskId, action] = taskActionMatch;
        try {
          const task = action === 'pause'
            ? downloadManager.pause(decodeURIComponent(taskId))
            : downloadManager.resume(decodeURIComponent(taskId));
          if (!task) {
            sendError(response, 404, 'TASK_NOT_FOUND', '未找到该下载任务。');
            return;
          }
          sendJson(response, 200, clientTask(task));
        } catch (error) {
          sendError(response, 409, 'INVALID_TASK_STATE', error.message || '当前任务不能执行此操作。');
        }
        return;
      }

      const taskMatch = request.method === 'GET' && pathname.match(/^\/api\/downloads\/([^/]+)$/);
      if (taskMatch) {
        const task = downloadManager.get(decodeURIComponent(taskMatch[1]));
        if (!task) {
          sendError(response, 404, 'TASK_NOT_FOUND', '未找到该下载任务。');
          return;
        }
        sendJson(response, 200, clientTask(task));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/open-downloads') {
        await openDownloads();
        response.writeHead(204);
        response.end();
        return;
      }

      if (request.method === 'GET' && pathname.startsWith('/api/files/')) {
        let name;
        try {
          name = decodeURIComponent(pathname.slice('/api/files/'.length));
          const filename = resolveDownloadPath(downloadsDir, name);
          const stat = await fs.promises.stat(filename);
          if (!stat.isFile()) throw new Error('Not a file.');
          response.writeHead(200, {
            'content-type': 'video/mp4',
            'content-length': stat.size,
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filename))}`,
            'cache-control': 'private, no-store',
          });
          fs.createReadStream(filename).pipe(response);
        } catch {
          sendError(response, 404, 'FILE_NOT_FOUND', '未找到该下载文件。');
        }
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendError(response, 404, 'NOT_FOUND', '未找到该接口。');
        return;
      }
      serveStatic(response, publicDir, pathname);
    } catch (error) {
      sendError(response, 500, 'INTERNAL_ERROR', error.message || '服务器处理请求时发生错误。');
    }
  });
}

function commandAvailable(command, args) {
  if (path.isAbsolute(command) && !fs.existsSync(command)) return false;
  const result = spawnSync(command, args, { windowsHide: true, stdio: 'ignore' });
  return !result.error && result.status === 0;
}

export function loopbackNoProxy(value = '') {
  const entries = String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
  const known = new Set(entries.map((entry) => entry.toLowerCase()));
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    if (!known.has(host)) entries.push(host);
  }
  return entries.join(',');
}

export function configureNetworkProxy(httpModule = http, env = process.env) {
  const noProxy = loopbackNoProxy(env.NO_PROXY || env.no_proxy);
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  return typeof httpModule.setGlobalProxyFromEnv === 'function'
    ? httpModule.setGlobalProxyFromEnv() : undefined;
}

async function start() {
  configureNetworkProxy();
  fs.mkdirSync(DEFAULT_DOWNLOADS_DIR, { recursive: true });
  const dependencies = {
    ytDlp: commandAvailable(DEFAULT_YTDLP_PATH, ['--version']),
    ffmpeg: commandAvailable(DEFAULT_FFMPEG_PATH, ['-version']),
    browser: Boolean(findBrowserExecutable()),
  };
  const browserPath = findBrowserExecutable();
  const resolver = (url) => resolveMedia(url, {
    ytDlpPath: dependencies.ytDlp ? DEFAULT_YTDLP_PATH : null,
    browserResolver: dependencies.browser
      ? (pageUrl, options) => resolveWithBrowser(pageUrl, {
        ...options,
        browserPath,
        profileDir: DEFAULT_BROWSER_PROFILE_DIR,
      })
      : null,
  });
  const interactiveResolver = (url) => resolveMedia(url, {
    ytDlpPath: dependencies.ytDlp ? DEFAULT_YTDLP_PATH : null,
    browserResolver: dependencies.browser
      ? (pageUrl, options) => resolveWithBrowser(pageUrl, {
        ...options,
        browserPath,
        profileDir: DEFAULT_BROWSER_PROFILE_DIR,
        headless: false,
        observationMs: 120_000,
      })
      : null,
  });
  const downloadManager = createDownloadManager({
    ytDlpPath: dependencies.ytDlp ? DEFAULT_YTDLP_PATH : null,
    ffmpegPath: dependencies.ffmpeg ? DEFAULT_FFMPEG_PATH : null,
    downloadsDir: DEFAULT_DOWNLOADS_DIR,
    historyFile: DEFAULT_HISTORY_FILE,
  });
  const server = createServer({ resolver, interactiveResolver, downloadManager, dependencies });
  const port = Number(process.env.PORT || 45210);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Video Downloader: http://127.0.0.1:${port}`);
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
