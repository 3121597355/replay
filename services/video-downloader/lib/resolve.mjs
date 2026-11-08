import { spawn } from 'node:child_process';

import { resolveWithBrowser } from './browser-resolve.mjs';
import { normalizePublicUrl, sanitizeFilename } from './security.mjs';

const MAX_PROCESS_OUTPUT = 5 * 1024 * 1024;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const DIRECT_MEDIA_RE = /\.(mp4|mkv|mov|webm|m3u8)(?:$|[?#])/i;

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([^\s=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function mediaFormat(url) {
  return /\.m3u8(?:$|[?#])/i.test(url) ? 'HLS' : 'MP4';
}

function absoluteMediaUrl(value, pageUrl, allowExtensionless = false) {
  const decoded = decodeHtml(value).replace(/\\\//g, '/').trim();
  try {
    const url = new URL(decoded, pageUrl);
    return ['http:', 'https:'].includes(url.protocol)
      && (allowExtensionless || DIRECT_MEDIA_RE.test(url.href))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function addMedia(items, seen, {
  title,
  url,
  pageUrl,
  resolver = 'html',
  format,
  http,
  manifest,
  allowExtensionless = false,
}) {
  const absolute = absoluteMediaUrl(url, pageUrl, allowExtensionless);
  if (!absolute || seen.has(absolute)) return;
  seen.add(absolute);
  items.push({
    id: `html-${items.length + 1}`,
    title: decodeHtml(title).trim() || `Video ${items.length + 1}`,
    duration: null,
    format: format || mediaFormat(absolute),
    resolution: 'Auto',
    thumbnail: null,
    sourceUrl: pageUrl,
    directUrl: absolute,
    resolver,
    url: absolute,
    ...(http ? { http } : {}),
    ...(manifest ? { manifest } : {}),
  });
}

function playerConfigs(html) {
  const configs = [];
  const source = String(html);
  for (const assignment of source.matchAll(/\bvar\s+player_aaaa\s*=\s*/gi)) {
    const start = assignment.index + assignment[0].length;
    if (source[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          configs.push(source.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return configs;
}

export function extractHtmlMedia(html, pageUrl) {
  const items = [];
  const seen = new Set();

  for (const tagMatch of String(html).matchAll(/<(?:div|section)\b[^>]*>/gi)) {
    const attributes = parseAttributes(tagMatch[0]);
    const classes = (attributes.class ?? '').split(/\s+/);
    if (!classes.includes('dplayer')) continue;

    const title = attributes['data-video_title']
      ?? attributes['data-video-title']
      ?? attributes.title;
    const configs = Object.entries(attributes)
      .filter(([name, value]) => name.startsWith('data-') && /["{](?:video|url)["}]/i.test(value))
      .map(([, value]) => value);

    for (const configText of configs) {
      try {
        const config = JSON.parse(configText);
        const url = config?.video?.url ?? config?.url;
        if (url) addMedia(items, seen, { title, url, pageUrl });
      } catch {
        // A malformed player config must not prevent other media from being found.
      }
    }
  }

  for (const configText of playerConfigs(html)) {
    try {
      const config = JSON.parse(configText);
      addMedia(items, seen, {
        title: config?.vod_data?.vod_name ?? config?.title,
        url: config?.url,
        pageUrl,
      });
    } catch {
      // A malformed player configuration must not prevent other media from being found.
    }
  }

  for (const match of String(html).matchAll(/<(video|source)\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if (!attributes.src) continue;
    addMedia(items, seen, {
      title: attributes.title || attributes['data-title'],
      url: attributes.src,
      pageUrl,
    });
  }

  return items;
}

function collectProcess(child, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new Error('视频解析超时，请检查网络后重试。'));
      child.kill?.();
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_PROCESS_OUTPUT) {
        child.kill?.();
        fail(new Error('yt-dlp returned too much data.'));
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr.trim() || `yt-dlp exited with code ${code}`).slice(-2_000)));
        return;
      }
      resolve(stdout);
    });
  });
}

function normalizeEntry(entry, fallbackUrl, index) {
  const width = Number(entry.width) || null;
  const height = Number(entry.height) || null;
  return {
    id: String(entry.id ?? `media-${index + 1}`),
    title: String(entry.title ?? `Video ${index + 1}`),
    duration: Number.isFinite(Number(entry.duration)) ? Number(entry.duration) : null,
    format: String(entry.ext ?? entry.format_id ?? 'video').toUpperCase(),
    resolution: width && height ? `${width}x${height}` : String(entry.resolution ?? 'Auto'),
    thumbnail: entry.thumbnail ? String(entry.thumbnail) : null,
    sourceUrl: String(entry.webpage_url ?? fallbackUrl),
    directUrl: null,
    resolver: 'yt-dlp',
  };
}

export async function resolveWithYtDlp(url, {
  ytDlpPath,
  processFactory = spawn,
  timeoutMs,
} = {}) {
  if (!ytDlpPath) throw new Error('yt-dlp is not available.');
  const child = processFactory(ytDlpPath, [
    '--ignore-config',
    '--socket-timeout', '15',
    '--retries', '1',
    '--dump-single-json',
    '--no-warnings',
    '--no-playlist',
    '--skip-download',
    '--',
    url,
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const raw = await collectProcess(child, timeoutMs);
  let info;
  try {
    info = JSON.parse(raw);
  } catch {
    throw new Error('yt-dlp returned invalid JSON.');
  }

  const entries = Array.isArray(info.entries) ? info.entries.filter(Boolean) : [info];
  if (!entries.length) throw new Error('yt-dlp found no media.');
  return {
    title: String(info.title ?? entries[0]?.title ?? 'Video'),
    thumbnail: info.thumbnail ? String(info.thumbnail) : null,
    items: entries.map((entry, index) => normalizeEntry(entry, url, index)),
  };
}

async function readLimitedText(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_HTML_BYTES) throw new Error('Page is too large to inspect.');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error('Page is too large to inspect.');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchPublicHtml(initialUrl, { fetchFn, lookup }) {
  let current = await normalizePublicUrl(initialUrl, { lookup });
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchFn(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'LocalVideoDownloader/1.0' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Remote redirect has no location.');
      current = await normalizePublicUrl(new URL(location, current).href, { lookup });
      continue;
    }
    const html = await readLimitedText(response);
    if (isBrowserChallengePage(html)) throw browserVerificationError();
    if (!response.ok) throw new Error(`Remote page returned HTTP ${response.status}.`);
    return { html, url: current.href };
  }
  throw new Error('Remote page redirected too many times.');
}

function pageTitle(html) {
  const match = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1]).replace(/\s+/g, ' ').trim() : 'Video';
}

export function isBrowserChallengePage(html) {
  const source = String(html ?? '').toLowerCase();
  return source.includes('_cf_chl_opt')
    && (source.includes('just a moment')
      || source.includes('enable javascript and cookies')
      || source.includes('challenge-platform'));
}

function browserVerificationError() {
  const error = new Error('This page requires verification in a visible browser.');
  error.code = 'BROWSER_VERIFICATION_REQUIRED';
  return error;
}

export async function resolveMedia(input, {
  ytDlpPath,
  processFactory = spawn,
  fetchFn = fetch,
  lookup,
  browserResolver = resolveWithBrowser,
} = {}) {
  const url = await normalizePublicUrl(input, { lookup });
  if (DIRECT_MEDIA_RE.test(url.href)) {
    const rawName = decodeURIComponent(url.pathname.split('/').pop() || 'video').replace(/\.(mp4|m3u8)$/i, '');
    const format = mediaFormat(url.href);
    return {
      title: sanitizeFilename(rawName),
      thumbnail: null,
      items: [{
        id: 'direct-1',
        title: sanitizeFilename(rawName),
        duration: null,
        format,
        resolution: 'Auto',
        thumbnail: null,
        sourceUrl: url.href,
        directUrl: url.href,
        resolver: 'direct',
      }],
    };
  }

  try {
    return await resolveWithYtDlp(url.href, { ytDlpPath, processFactory });
  } catch {
    let page;
    let pageError;
    try {
      page = await fetchPublicHtml(url.href, { fetchFn, lookup });
      const items = extractHtmlMedia(page.html, page.url);
      if (items.length) return { title: pageTitle(page.html), thumbnail: null, items };
    } catch (error) {
      pageError = error;
      if (!browserResolver) throw error;
    }

    if (browserResolver) {
      try {
        const items = [];
        const seen = new Set();
        const browserUrls = await browserResolver(page?.url ?? url.href, { lookup });
        for (const browserMedia of browserUrls) {
          const mediaUrl = typeof browserMedia === 'string' ? browserMedia : browserMedia?.url;
          addMedia(items, seen, {
            url: mediaUrl,
            pageUrl: page?.url ?? url.href,
            resolver: 'browser',
            format: typeof browserMedia === 'object' ? browserMedia?.format : null,
            http: typeof browserMedia === 'object' ? browserMedia?.http : null,
            manifest: typeof browserMedia === 'object' ? browserMedia?.manifest : null,
            allowExtensionless: typeof browserMedia === 'object',
          });
        }
        if (items.length) return {
          title: page ? pageTitle(page.html) : 'Video',
          thumbnail: null,
          items,
        };
      } catch (error) {
        if (error?.code === 'BROWSER_VERIFICATION_TIMEOUT') throw error;
        // Browser capture is optional; keep the existing neutral resolver error.
      }
    }
    if (pageError?.code === 'BROWSER_VERIFICATION_REQUIRED') throw pageError;
    throw new Error('No downloadable media was found on this page.');
  }
}
