import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { normalizePublicUrl } from './security.mjs';

const MEDIA_RESPONSE_RE = /\.(?:mp4|m3u8)(?:$|[?#])/i;
const HLS_MIME_RE = /^(?:application|audio)\/(?:vnd\.apple\.|x-)?mpegurl(?:\s*;|$)/i;
const MP4_MIME_RE = /^(?:video|application)\/mp4(?:\s*;|$)/i;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_OBSERVATION_MS = 7_000;
const MAX_PLAYER_HTML_BYTES = 1_000_000;
const MAX_HLS_MANIFEST_BYTES = 2_000_000;

function browserCandidates() {
  if (process.platform !== 'win32') return [];
  return [
    process.env.VIDEO_DOWNLOADER_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
}

export function findBrowserExecutable({ candidates = browserCandidates(), exists = fs.existsSync } = {}) {
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

export function browserProxyArgument(env = process.env) {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    if (!env?.[key]) continue;
    try {
      const proxy = new URL(env[key]);
      if (!['http:', 'https:'].includes(proxy.protocol) || !proxy.hostname || proxy.username || proxy.password) continue;
      return `--proxy-server=${proxy.protocol}//${proxy.host}`;
    } catch {
      // Continue checking the remaining proxy environment variables.
    }
  }
  return null;
}

export function browserLaunchArguments({
  profileDir,
  headless = true,
  env = process.env,
  debuggingPort = 9229,
} = {}) {
  const proxyArgument = browserProxyArgument(env);
  return [
    ...(headless ? ['--headless=new', '--disable-gpu'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-allow-origins=*',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDir}`,
    ...(proxyArgument ? [proxyArgument] : []),
    'about:blank',
  ];
}

function mediaCandidatesFromResponses(responses) {
  const found = [];
  const seen = new Set();
  for (const response of responses) {
    try {
      const value = typeof response === 'string' ? response : response?.url;
      const mimeType = typeof response === 'object' ? String(response?.mimeType ?? '') : '';
      const url = new URL(value);
      const format = HLS_MIME_RE.test(mimeType) || /\.m3u8(?:$|[?#])/i.test(url.href)
        ? 'HLS'
        : MP4_MIME_RE.test(mimeType) || /\.mp4(?:$|[?#])/i.test(url.href)
          ? 'MP4'
          : null;
      if (!['http:', 'https:'].includes(url.protocol) || !format || seen.has(url.href)) continue;
      seen.add(url.href);
      found.push({
        url: url.href,
        format,
        referer: typeof response === 'object' ? response?.referer : null,
        requestId: typeof response === 'object' ? response?.requestId : null,
      });
    } catch {
      // Ignore malformed DevTools events.
    }
  }
  return found;
}

export function mediaUrlsFromResponses(responses) {
  return mediaCandidatesFromResponses(responses).map((candidate) => candidate.url);
}

export function ffmpegCookiesFromDevTools(cookies) {
  return (Array.isArray(cookies) ? cookies : [])
    .map((cookie) => {
      const name = String(cookie?.name ?? '').replace(/[\r\n]/g, '');
      const value = String(cookie?.value ?? '').replace(/[\r\n]/g, '');
      if (!name) return null;
      const parts = [`${name}=${value}`];
      if (cookie?.path) parts.push(`path=${String(cookie.path).replace(/[\r\n]/g, '')}`);
      if (cookie?.domain) parts.push(`domain=${String(cookie.domain).replace(/[\r\n]/g, '')}`);
      if (cookie?.secure) parts.push('secure');
      return `${parts.join('; ')};`;
    })
    .filter(Boolean)
    .join('\n');
}

export function browserResponseBodyText(responseBody) {
  if (!responseBody || typeof responseBody.body !== 'string') return null;
  const body = responseBody.base64Encoded
    ? Buffer.from(responseBody.body, 'base64').toString('utf8')
    : responseBody.body;
  if (Buffer.byteLength(body) > MAX_HLS_MANIFEST_BYTES || !body.trimStart().startsWith('#EXTM3U')) {
    return null;
  }
  return body;
}

export function mediaUrlsFromText(text) {
  const candidates = String(text ?? '')
    .replace(/\\\//g, '/')
    .match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  return mediaUrlsFromResponses(candidates);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findAvailableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error('Unable to allocate a local browser debugging port.'));
      });
    });
  });
}

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('The browser DevTools connection timed out.'));
    }, 5_000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve(socket);
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Unable to connect to the browser DevTools endpoint.'));
    }, { once: true });
  });
}

class DevToolsConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Set();
    socket.addEventListener('message', (event) => this.onMessage(event));
    socket.addEventListener('close', () => this.failPending(new Error('The browser DevTools connection closed.')));
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'Chrome DevTools returned an error.'));
      else pending.resolve(message.result);
      return;
    }
    for (const handler of this.handlers) handler(message);
  }

  call(method, params = {}, sessionId) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  onEvent(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  failPending(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  close() {
    this.failPending(new Error('The browser resolver has finished.'));
    this.socket.close();
  }
}

function getBrowserWebSocketUrl(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/json/version', timeout: 5_000, agent: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error('The local browser DevTools endpoint is unavailable.'));
          return;
        }
        try {
          const version = JSON.parse(body);
          if (!version.webSocketDebuggerUrl) throw new Error('Missing WebSocket URL.');
          const socketUrl = new URL(version.webSocketDebuggerUrl);
          if (socketUrl.hostname === 'localhost') socketUrl.hostname = '127.0.0.1';
          resolve(socketUrl.href);
        } catch {
          reject(new Error('The local browser did not provide a DevTools WebSocket URL.'));
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('The local browser DevTools endpoint timed out.')));
    request.once('error', reject);
  });
}

async function waitForBrowserWebSocketUrl(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await getBrowserWebSocketUrl(port);
    } catch {
      await delay(100);
    }
  }
  throw new Error('The local browser did not start its DevTools connection in time.');
}

async function readLimitedText(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_PLAYER_HTML_BYTES) throw new Error('Embedded player response is too large.');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PLAYER_HTML_BYTES) {
      await reader.cancel();
      throw new Error('Embedded player response is too large.');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchEmbeddedPlayerMedia(frameUrl, pageUrl, { fetchFn, lookup }) {
  let current = await normalizePublicUrl(frameUrl, { lookup });
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchFn(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        referer: pageUrl,
        'user-agent': 'LocalVideoDownloader/1.0',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Embedded player redirect has no location.');
      current = await normalizePublicUrl(new URL(location, current).href, { lookup });
      continue;
    }
    if (!response.ok) throw new Error(`Embedded player returned HTTP ${response.status}.`);
    return mediaUrlsFromText(await readLimitedText(response));
  }
  throw new Error('Embedded player redirected too many times.');
}

async function frameUrlsFromPage(connection, sessionId) {
  const result = await connection.call('Runtime.evaluate', {
    expression: "Array.from(document.querySelectorAll('iframe[src]'), (frame) => frame.src)",
    returnByValue: true,
  }, sessionId);
  return Array.isArray(result.result?.value) ? result.result.value : [];
}

async function pageDiagnostic(connection, sessionId, fallbackUrl) {
  const result = await connection.call('Runtime.evaluate', {
    expression: "({ url: location.href, title: document.title, iframeCount: document.querySelectorAll('iframe').length })",
    returnByValue: true,
  }, sessionId);
  const value = result.result?.value ?? {};
  return {
    url: String(value.url || fallbackUrl),
    title: String(value.title || ''),
    iframeCount: Number(value.iframeCount) || 0,
  };
}

function browserVerificationTimeout(diagnostic) {
  const error = new Error('浏览器验证未完成或已超时，请重试。');
  error.code = 'BROWSER_VERIFICATION_TIMEOUT';
  error.diagnostic = diagnostic;
  return error;
}

function stopBrowser(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try {
    child.kill();
  } catch {
    // The browser has already exited.
  }
}

export async function resolveWithBrowser(pageUrl, {
  browserPath = findBrowserExecutable(),
  profileDir: configuredProfileDir,
  headless = true,
  fetchFn = fetch,
  lookup,
  processFactory = spawn,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  observationMs = DEFAULT_OBSERVATION_MS,
} = {}) {
  if (!browserPath) return [];

  const ownsProfile = !configuredProfileDir;
  const profileDir = configuredProfileDir
    ? path.resolve(configuredProfileDir)
    : await fsp.mkdtemp(path.join(os.tmpdir(), 'video-downloader-browser-'));
  await fsp.mkdir(profileDir, { recursive: true });
  await fsp.unlink(path.join(profileDir, 'DevToolsActivePort')).catch(() => {});
  let child;
  let connection;
  let closeEvents;
  try {
    const debuggingPort = await findAvailableLoopbackPort();
    child = processFactory(
      browserPath,
      browserLaunchArguments({ profileDir, headless, env, debuggingPort }),
      { stdio: 'ignore', windowsHide: headless },
    );

    const socket = await openWebSocket(await waitForBrowserWebSocketUrl(debuggingPort, timeoutMs));
    connection = new DevToolsConnection(socket);
    const { targetId } = await connection.call('Target.createTarget', { url: 'about:blank' });
    await connection.call('Target.activateTarget', { targetId });
    const { sessionId } = await connection.call('Target.attachToTarget', { targetId, flatten: true });
    const responseUrls = [];
    const requestContext = new Map();
    const { userAgent = '' } = await connection.call('Browser.getVersion');

    closeEvents = connection.onEvent((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Network.requestWillBeSent') {
        const requestId = message.params?.requestId;
        if (requestId) {
          requestContext.set(requestId, {
            referer: message.params?.request?.headers?.Referer
              ?? message.params?.request?.headers?.referer
              ?? message.params?.documentURL,
          });
        }
        return;
      }
      if (message.method === 'Network.responseReceived') {
        const context = requestContext.get(message.params?.requestId);
        responseUrls.push({
          url: message.params?.response?.url,
          mimeType: message.params?.response?.mimeType,
          referer: context?.referer,
          requestId: message.params?.requestId,
        });
        return;
      }
      if (message.method !== 'Fetch.requestPaused') return;
      const requestId = message.params?.requestId;
      const requestUrl = message.params?.request?.url;
      if (!requestId || !requestUrl) return;
      void (async () => {
        try {
          const request = new URL(requestUrl);
          if (['http:', 'https:'].includes(request.protocol)) {
            await normalizePublicUrl(request.href, { lookup });
          }
          await connection.call('Fetch.continueRequest', { requestId }, sessionId);
        } catch {
          await connection.call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => {});
        }
      })();
    });

    await connection.call('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
    await connection.call('Network.enable', {}, sessionId);
    await connection.call('Page.enable', {}, sessionId);
    await connection.call('Page.navigate', { url: pageUrl }, sessionId);
    const embeddedCandidates = [];
    const frameAttempts = new Map();
    const deadline = Date.now() + observationMs;
    while (Date.now() < deadline) {
      await delay(750);
      await connection.call('Runtime.evaluate', {
        expression: "document.querySelectorAll('video').forEach((video) => video.play().catch(() => {}));",
        returnByValue: true,
      }, sessionId).catch(() => {});

      const frameUrls = await frameUrlsFromPage(connection, sessionId).catch(() => []);
      for (const frameUrl of frameUrls) {
        const lastAttempt = frameAttempts.get(frameUrl) ?? 0;
        if (Date.now() - lastAttempt < 3_000) continue;
        frameAttempts.set(frameUrl, Date.now());
        try {
          embeddedCandidates.push(...await fetchEmbeddedPlayerMedia(frameUrl, pageUrl, { fetchFn, lookup }));
        } catch {
          // A blocked iframe can become available after the user completes verification.
        }
      }

      const candidates = mediaCandidatesFromResponses([...responseUrls, ...embeddedCandidates]);
      const publicCandidates = [];
      for (const candidate of candidates) {
        try {
          const mediaUrl = (await normalizePublicUrl(candidate.url, { lookup })).href;
          let referer = pageUrl;
          try {
            referer = (await normalizePublicUrl(candidate.referer || pageUrl, { lookup })).href;
          } catch {
            // Use the original public page as a safe fallback referer.
          }
          const cookieResult = await connection.call('Network.getCookies', {
            urls: [mediaUrl, referer],
          }, sessionId).catch(() => ({ cookies: [] }));
          const responseBody = candidate.format === 'HLS' && candidate.requestId
            ? await connection.call('Network.getResponseBody', {
              requestId: candidate.requestId,
            }, sessionId).catch(() => null)
            : null;
          publicCandidates.push({
            url: mediaUrl,
            format: candidate.format,
            manifest: browserResponseBodyText(responseBody),
            http: {
              userAgent,
              referer,
              cookies: ffmpegCookiesFromDevTools(cookieResult.cookies),
            },
          });
        } catch {
          // A captured URL must still meet the same public-address policy.
        }
      }
      if (publicCandidates.length) return publicCandidates;
    }
    const diagnostic = await pageDiagnostic(connection, sessionId, pageUrl)
      .catch(() => ({ url: pageUrl, title: '', iframeCount: 0 }));
    throw browserVerificationTimeout(diagnostic);
  } finally {
    closeEvents?.();
    await connection?.call('Browser.close').catch(() => {});
    connection?.close();
    stopBrowser(child);
    if (ownsProfile) await fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}
