import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  extractHtmlMedia,
  isBrowserChallengePage,
  resolveMedia,
  resolveWithYtDlp,
} from '../lib/resolve.mjs';

function fakeProcess({ stdout = '', stderr = '', code = 0 }) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      child.emit('close', code);
    });
    return child;
  };
}

test('extracts and deduplicates DPlayer HLS entries', () => {
  const html = `
    <div class="dplayer" data-video_title="Part 1"
      data-config='{&quot;video&quot;:{&quot;url&quot;:&quot;https:\\/\\/cdn.example.com\\/one.m3u8?token=x&quot;,&quot;type&quot;:&quot;hls&quot;}}'></div>
    <div class="dplayer" data-video-title="Part 2"
      data-player='{"video":{"url":"https://cdn.example.com/two.m3u8","type":"hls"}}'></div>
    <source src="https://cdn.example.com/one.m3u8?token=x">
  `;

  const items = extractHtmlMedia(html, 'https://example.com/post');
  assert.deepEqual(items.map(({ title, url, format }) => ({ title, url, format })), [
    { title: 'Part 1', url: 'https://cdn.example.com/one.m3u8?token=x', format: 'HLS' },
    { title: 'Part 2', url: 'https://cdn.example.com/two.m3u8', format: 'HLS' },
  ]);
});

test('extracts video and source elements with relative URLs', () => {
  const html = `
    <video title="Trailer" src="/media/trailer.mp4"></video>
    <video><source src="clips/main.m3u8" type="application/x-mpegURL"></video>
  `;
  const items = extractHtmlMedia(html, 'https://example.com/posts/1');
  assert.deepEqual(items.map(({ title, url }) => ({ title, url })), [
    { title: 'Trailer', url: 'https://example.com/media/trailer.mp4' },
    { title: 'Video 2', url: 'https://example.com/posts/clips/main.m3u8' },
  ]);
});

test('ignores malformed player configuration without throwing', () => {
  const html = `<div class="dplayer" data-config='{bad json'></div>`;
  assert.deepEqual(extractHtmlMedia(html, 'https://example.com/post'), []);
});

test('extracts an HLS URL from a player_aaaa JSON assignment', () => {
  const html = `
    <script>var player_aaaa = {"vod_data":{"vod_name":"Episode 1"},"url":"https://cdn.example.com/episode.m3u8"};</script>
  `;
  const items = extractHtmlMedia(html, 'https://example.com/watch');
  assert.deepEqual(items.map(({ title, url, format }) => ({ title, url, format })), [
    { title: 'Episode 1', url: 'https://cdn.example.com/episode.m3u8', format: 'HLS' },
  ]);
});

test('extracts player_aaaa JSON when the assignment has no trailing semicolon', () => {
  const html = `
    <script>var player_aaaa={"vod_data":{"vod_name":"Episode 2"},"url":"https://cdn.example.com/episode-2.m3u8"}</script>
  `;
  const items = extractHtmlMedia(html, 'https://example.com/watch');
  assert.deepEqual(items.map(({ title, url }) => ({ title, url })), [
    { title: 'Episode 2', url: 'https://cdn.example.com/episode-2.m3u8' },
  ]);
});

test('ignores malformed player_aaaa JSON without throwing', () => {
  const html = `<script>var player_aaaa = {not valid json};</script>`;
  assert.deepEqual(extractHtmlMedia(html, 'https://example.com/watch'), []);
});

test('normalizes yt-dlp JSON output', async () => {
  const payload = JSON.stringify({
    id: 'abc',
    title: 'Example clip',
    duration: 65,
    thumbnail: 'https://img.example/thumb.jpg',
    webpage_url: 'https://example.com/watch/abc',
    ext: 'mp4',
    width: 1920,
    height: 1080,
    format_id: 'best',
  });

  const result = await resolveWithYtDlp('https://example.com/watch/abc', {
    ytDlpPath: 'yt-dlp',
    processFactory: fakeProcess({ stdout: payload }),
  });
  assert.equal(result.title, 'Example clip');
  assert.deepEqual(result.items[0], {
    id: 'abc',
    title: 'Example clip',
    duration: 65,
    format: 'MP4',
    resolution: '1920x1080',
    thumbnail: 'https://img.example/thumb.jpg',
    sourceUrl: 'https://example.com/watch/abc',
    directUrl: null,
    resolver: 'yt-dlp',
  });
});

test('reports yt-dlp process failures with a bounded message', async () => {
  await assert.rejects(
    () => resolveWithYtDlp('https://example.com/watch/abc', {
      ytDlpPath: 'yt-dlp',
      processFactory: fakeProcess({ stderr: 'Unsupported URL', code: 1 }),
    }),
    /unsupported url/i,
  );
});

test('resolves direct MP4 and HLS URLs without invoking yt-dlp', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const mp4 = await resolveMedia('https://example.com/video/demo.mp4?download=1', { lookup });
  const hls = await resolveMedia('https://example.com/live/master.m3u8', { lookup });
  assert.equal(mp4.items[0].format, 'MP4');
  assert.equal(hls.items[0].format, 'HLS');
  assert.equal(mp4.items[0].resolver, 'direct');
  assert.equal(hls.items[0].directUrl, 'https://example.com/live/master.m3u8');
});

test('falls back to public HTML when yt-dlp finds no media', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const fetchFn = async () => new Response(
    '<title>Page title</title><video src="https://cdn.example.com/fallback.mp4"></video>',
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
  const result = await resolveMedia('https://example.com/post', {
    lookup,
    fetchFn,
    ytDlpPath: 'yt-dlp',
    processFactory: fakeProcess({ stderr: 'Unsupported URL', code: 1 }),
  });
  assert.equal(result.title, 'Page title');
  assert.equal(result.items[0].directUrl, 'https://cdn.example.com/fallback.mp4');
  assert.equal(result.items[0].resolver, 'html');
});

test('uses the browser fallback when static HTML has no media', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const result = await resolveMedia('https://example.com/watch', {
    lookup,
    fetchFn: async () => new Response('<title>Episode</title>', { status: 200 }),
    browserResolver: async () => ['https://cdn.example.com/episode.m3u8?token=one'],
  });
  assert.equal(result.title, 'Episode');
  assert.equal(result.items[0].resolver, 'browser');
  assert.equal(result.items[0].directUrl, 'https://cdn.example.com/episode.m3u8?token=one');
});

test('keeps an extensionless HLS endpoint identified by the browser response MIME type', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const result = await resolveMedia('https://example.com/watch', {
    lookup,
    fetchFn: async () => new Response('<title>Episode</title>', { status: 200 }),
    browserResolver: async () => [{
      url: 'https://cdn.example.com/player/manifest?id=one',
      format: 'HLS',
      http: {
        userAgent: 'Chrome test',
        referer: 'https://example.com/player/',
        cookies: 'cf_clearance=token; path=/; domain=.example.com; secure;',
      },
      manifest: '#EXTM3U\nhttps://cdn.example.com/segment.ts\n',
    }],
  });
  assert.equal(result.items[0].format, 'HLS');
  assert.equal(result.items[0].directUrl, 'https://cdn.example.com/player/manifest?id=one');
  assert.deepEqual(result.items[0].http, {
    userAgent: 'Chrome test',
    referer: 'https://example.com/player/',
    cookies: 'cf_clearance=token; path=/; domain=.example.com; secure;',
  });
  assert.equal(result.items[0].manifest, '#EXTM3U\nhttps://cdn.example.com/segment.ts\n');
});

test('recognizes and reports a browser verification challenge', async () => {
  const html = '<title>Just a moment...</title><p>Enable JavaScript and cookies to continue</p><script>window._cf_chl_opt={}</script>';
  assert.equal(isBrowserChallengePage(html), true);
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  await assert.rejects(
    () => resolveMedia('https://example.com/watch', {
      lookup,
      fetchFn: async () => new Response(html, { status: 403 }),
      browserResolver: async () => [],
    }),
    (error) => error.code === 'BROWSER_VERIFICATION_REQUIRED',
  );
});

test('preserves an interactive browser verification timeout', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const browserError = new Error('浏览器验证未完成或已超时，请重试。');
  browserError.code = 'BROWSER_VERIFICATION_TIMEOUT';

  await assert.rejects(
    () => resolveMedia('https://example.com/watch', {
      lookup,
      fetchFn: async () => new Response('<title>Episode</title>', { status: 200 }),
      browserResolver: async () => { throw browserError; },
    }),
    (error) => error === browserError,
  );
});
test('terminates a resolver process that never returns', async () => {
  let killed = false;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { killed = true; child.emit('close', 1); };
  const timer = setTimeout(() => {}, 100);
  try {
    await assert.rejects(resolveWithYtDlp('https://example.com/video', {
      ytDlpPath: 'yt-dlp', processFactory: () => child, timeoutMs: 20,
    }), /解析超时/);
    assert.equal(killed, true);
  } finally { clearTimeout(timer); }
});
