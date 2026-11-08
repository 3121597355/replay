import test from 'node:test';
import assert from 'node:assert/strict';

import {
  browserLaunchArguments,
  browserProxyArgument,
  browserResponseBodyText,
  ffmpegCookiesFromDevTools,
  findBrowserExecutable,
  mediaUrlsFromResponses,
  mediaUrlsFromText,
} from '../lib/browser-resolve.mjs';

test('keeps unique MP4 and HLS response URLs', () => {
  assert.deepEqual(mediaUrlsFromResponses([
    'https://cdn.example.com/video/master.m3u8?token=one',
    'https://cdn.example.com/app.js',
    'https://cdn.example.com/clip.mp4',
    'https://cdn.example.com/clip.mp4',
  ]), [
    'https://cdn.example.com/video/master.m3u8?token=one',
    'https://cdn.example.com/clip.mp4',
  ]);
});

test('recognizes an HLS response by MIME type when the URL has no media extension', () => {
  assert.deepEqual(mediaUrlsFromResponses([{
    url: 'https://example.com/player/m3u8.php?token=one',
    mimeType: 'application/vnd.apple.mpegurl',
  }]), ['https://example.com/player/m3u8.php?token=one']);
});

test('extracts escaped HLS URLs from an embedded player response', () => {
  assert.deepEqual(mediaUrlsFromText(
    '<script>const source = "https:\\/\\/cdn.example.com\\/master.m3u8?token=one";</script>',
  ), ['https://cdn.example.com/master.m3u8?token=one']);
});

test('prefers an available Chrome executable', () => {
  assert.equal(findBrowserExecutable({
    candidates: ['C:\\Missing\\chrome.exe', 'C:\\Chrome\\chrome.exe'],
    exists: (candidate) => candidate === 'C:\\Chrome\\chrome.exe',
  }), 'C:\\Chrome\\chrome.exe');
});

test('passes a configured HTTP proxy to Chrome', () => {
  assert.equal(browserProxyArgument({ HTTPS_PROXY: 'http://127.0.0.1:7897' }), '--proxy-server=http://127.0.0.1:7897');
  assert.equal(browserProxyArgument({ HTTPS_PROXY: 'not a url' }), null);
});

test('builds visible Chrome arguments with a dedicated persistent profile', () => {
  const args = browserLaunchArguments({
    profileDir: 'C:\\video-downloader-profile',
    headless: false,
    env: {},
    debuggingPort: 19229,
  });
  assert.ok(args.includes('--user-data-dir=C:\\video-downloader-profile'));
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(args.includes('--remote-debugging-port=19229'));
  assert.equal(args.includes('--remote-debugging-port=0'), false);
  assert.equal(args.some((arg) => arg.startsWith('--headless')), false);
});

test('formats browser cookies for FFmpeg without losing domain restrictions', () => {
  assert.equal(ffmpegCookiesFromDevTools([
    { name: 'cf_clearance', value: 'token', domain: '.example.com', path: '/', secure: true },
    { name: 'session', value: 'value', domain: 'example.com', path: '/player', secure: false },
  ]), [
    'cf_clearance=token; path=/; domain=.example.com; secure;',
    'session=value; path=/player; domain=example.com;',
  ].join('\n'));
});

test('decodes a bounded base64 HLS response body from DevTools', () => {
  const manifest = '#EXTM3U\n#EXTINF:4,\nsegment.ts\n';
  assert.equal(browserResponseBodyText({
    body: Buffer.from(manifest).toString('base64'),
    base64Encoded: true,
  }), manifest);
});
