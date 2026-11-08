import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import {
  createDownloadManager as createRealDownloadManager,
  parseFfmpegDuration,
  parseFfmpegProgress,
  parseYtDlpProgress,
  prepareHlsManifest,
} from '../lib/download.mjs';

const createDownloadManager = options => createRealDownloadManager({ probe: async () => ({ streams: [] }), ...options });

function controlledProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit('close', 1);
  return child;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function waitUntil(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(predicate(), 'Download state did not settle before the deadline');
}

test('keeps the queue slot and pending budget until subtitle separation completes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-queue-'));
  const children = [];
  let release;
  const processing = new Promise(resolve => { release = resolve; });
  const manager = createDownloadManager({
    ytDlpPath: 'yt-dlp', downloadsDir: root, maxConcurrent: 1, maxPending: 2,
    processFactory: () => { const child = controlledProcess(); children.push(child); return child; },
    subtitleProcessor: () => processing,
  });
  try {
    const input = { title: 'Clip', item: { resolver: 'yt-dlp', sourceUrl: 'https://example.com/watch' } };
    const first = manager.create(input);
    const second = manager.create(input);
    await waitUntil(() => children.length === 1);
    await fs.writeFile(path.join(root, first.filename), 'downloaded-video');
    children[0].emit('close', 0);
    await waitUntil(() => manager.get(first.id).status === 'processing');
    assert.equal(manager.get(second.id).status, 'queued');
    assert.throws(() => manager.create(input), /任务已满/);
    release({ subtitles: [], subtitleStatus: 'none', subtitleWarning: '' });
    await waitUntil(() => children.length === 2);
    assert.equal(manager.get(first.id).status, 'completed');
    children[1].emit('close', 1);
    await waitUntil(() => manager.get(second.id).status === 'failed');
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('rejects excessive pending tasks and terminates stalled downloads', async () => {
  const manager = createDownloadManager({
    ytDlpPath: 'yt-dlp', downloadsDir: 'C:\\downloads',
    processFactory: controlledProcess, verifyOutput: async () => true,
    maxPending: 1, taskTimeoutMs: 25,
  });
  const input = { title: 'Clip', item: { resolver: 'yt-dlp', sourceUrl: 'https://example.com/video' } };
  const task = manager.create(input);
  assert.throws(() => manager.create(input), /任务已满/);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(manager.get(task.id).status, 'failed');
  assert.match(manager.get(task.id).error, /时限/);
});

test('stops a transfer whose actual temporary output exceeds its size budget', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-downloader-size-'));
  let lastChild;
  const manager = createDownloadManager({
    ytDlpPath: 'yt-dlp', downloadsDir: root, processFactory: () => { lastChild = controlledProcess(); return lastChild; },
    maxFileBytes: 8, sizeCheckMs: 10,
  });
  const task = manager.create({ title: 'Clip', item: { resolver: 'yt-dlp', sourceUrl: 'https://example.com/video' } });
  await fs.writeFile(path.join(root, `${task.filename}.part`), Buffer.alloc(9));
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(manager.get(task.id).status, 'failed');
  assert.match(manager.get(task.id).error, /容量限制/);
  const fast = manager.create({ title: 'Fast', item: { resolver: 'yt-dlp', sourceUrl: 'https://example.com/video' } });
  await tick();
  await fs.writeFile(path.join(root, fast.filename), Buffer.alloc(9));
  lastChild.emit('close', 0);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(manager.get(fast.id).status, 'failed');
  assert.match(manager.get(fast.id).error, /容量限制/);
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  await fs.rm(root, { recursive: true, force: true });
});

test('parses yt-dlp progress lines', () => {
  assert.deepEqual(parseYtDlpProgress('download:42.5%|1.2MiB/s|00:10'), {
    progress: 42.5,
    speed: '1.2MiB/s',
    eta: '00:10',
  });
  assert.equal(parseYtDlpProgress('unrelated output'), null);
});

test('parses FFmpeg duration metadata', () => {
  assert.equal(parseFfmpegDuration('Duration: 01:10:32.50, start: 0.0'), 4232.5);
  assert.equal(parseFfmpegDuration('Duration: N/A, start: 0.0'), null);
});

test('parses FFmpeg progress blocks', () => {
  assert.deepEqual(parseFfmpegProgress('out_time_ms=25000000\nspeed=1.4x\nprogress=continue', 100), {
    progress: 25,
    speed: '1.4x',
    eta: null,
    elapsed: 25,
  });
  assert.deepEqual(parseFfmpegProgress('progress=end', null), {
    progress: 100,
    speed: null,
    eta: null,
    elapsed: null,
  });
});

test('runs at most two download processes and drains the queue', async () => {
  const children = [];
  const manager = createDownloadManager({
    ytDlpPath: 'yt-dlp',
    ffmpegPath: 'ffmpeg',
    downloadsDir: 'C:\\downloads',
    processFactory: () => {
      const child = controlledProcess();
      children.push(child);
      return child;
    },
    verifyOutput: async () => true,
    maxConcurrent: 2,
  });

  const input = (id) => ({
    title: `Clip ${id}`,
    item: { id, resolver: 'yt-dlp', sourceUrl: `https://example.com/${id}`, duration: 60 },
  });
  const first = manager.create(input('a'));
  const second = manager.create(input('b'));
  const third = manager.create(input('c'));
  await tick();

  assert.equal(children.length, 2);
  assert.equal(manager.get(first.id).status, 'downloading');
  assert.equal(manager.get(second.id).status, 'downloading');
  assert.equal(manager.get(third.id).status, 'queued');

  children[0].emit('close', 0);
  await waitUntil(() => children.length === 3);
  assert.equal(children.length, 3);
  assert.equal(manager.get(first.id).status, 'completed');
  assert.equal(manager.get(third.id).status, 'downloading');
});

test('pauses active work without failing it and resumes it through the queue', async () => {
  const children = [];
  const manager = createDownloadManager({
    ytDlpPath: 'yt-dlp',
    downloadsDir: 'C:\\downloads',
    processFactory: () => {
      const child = controlledProcess();
      children.push(child);
      return child;
    },
    verifyOutput: async () => true,
  });
  const task = manager.create({
    title: 'Clip',
    item: { resolver: 'yt-dlp', sourceUrl: 'https://example.com/watch', duration: 60 },
  });
  await tick();

  assert.equal(manager.pause(task.id).status, 'paused');
  await tick();
  assert.equal(manager.get(task.id).status, 'paused');
  assert.equal(manager.get(task.id).error, null);

  assert.equal(manager.resume(task.id).status, 'queued');
  await tick();
  await tick();
  assert.equal(children.length, 2);
  assert.equal(manager.get(task.id).status, 'downloading');
});

test('pauses queued work before it starts', async () => {
  const children = [];
  const manager = createDownloadManager({
    ytDlpPath: 'yt-dlp',
    downloadsDir: 'C:\\downloads',
    maxConcurrent: 1,
    processFactory: () => {
      const child = controlledProcess();
      children.push(child);
      return child;
    },
    verifyOutput: async () => true,
  });
  const first = manager.create({ title: 'First', item: { resolver: 'yt-dlp', sourceUrl: 'https://example.com/1' } });
  const second = manager.create({ title: 'Second', item: { resolver: 'yt-dlp', sourceUrl: 'https://example.com/2' } });
  await tick();

  assert.equal(manager.pause(second.id).status, 'paused');
  children[0].emit('close', 0);
  await waitUntil(() => manager.get(first.id).status === 'completed');
  assert.equal(manager.get(first.id).status, 'completed');
  assert.equal(children.length, 1);
});

test('updates progress and completes a task with a safe filename', async () => {
  let child;
  const manager = createDownloadManager({
    ytDlpPath: 'yt-dlp',
    ffmpegPath: 'ffmpeg',
    downloadsDir: 'C:\\downloads',
    processFactory: () => (child = controlledProcess()),
    verifyOutput: async () => true,
    validateUrl: async (value) => new URL(value),
  });
  const task = manager.create({
    title: 'Demo: clip?',
    item: { resolver: 'yt-dlp', sourceUrl: 'https://example.com/watch/1', duration: 60 },
  });
  await tick();
  child.stdout.write('download:55.2%|3.1MiB/s|00:04\n');
  await tick();
  assert.equal(manager.get(task.id).progress, 55.2);
  assert.equal(manager.get(task.id).filename, 'Demo clip.mp4');

  child.emit('close', 0);
  await waitUntil(() => manager.get(task.id).status === 'completed');
  assert.equal(manager.get(task.id).status, 'completed');
  assert.equal(manager.get(task.id).progress, 100);
});

test('uses FFmpeg metadata duration for direct-media progress', async () => {
  let child;
  const manager = createDownloadManager({
    ffmpegPath: 'ffmpeg',
    downloadsDir: 'C:\\downloads',
    processFactory: () => (child = controlledProcess()),
    verifyOutput: async () => true,
    validateUrl: async (value) => new URL(value),
  });
  const task = manager.create({
    title: 'HLS clip',
    item: {
      resolver: 'html',
      directUrl: 'https://cdn.example/clip.m3u8',
      sourceUrl: 'https://example.com/post',
      duration: null,
    },
  });
  await tick();
  child.stderr.write('Duration: 00:10:00.00, start: 0.0\n');
  child.stdout.write('out_time_ms=150000000\nspeed=2.0x\nprogress=continue\n');
  await tick();
  assert.equal(manager.get(task.id).progress, 25);
  assert.equal(manager.get(task.id).elapsed, 150);
});

test('passes browser session context to FFmpeg for protected HLS manifests', async () => {
  let invocation;
  const manager = createDownloadManager({
    ffmpegPath: 'ffmpeg',
    downloadsDir: 'C:\\downloads',
    processFactory: (executable, args) => {
      invocation = { executable, args };
      return controlledProcess();
    },
    verifyOutput: async () => true,
    validateUrl: async (value) => new URL(value),
  });
  const task = manager.create({
    title: 'Protected HLS',
    item: {
      resolver: 'browser',
      directUrl: 'https://example.com/player/manifest?id=one',
      sourceUrl: 'https://example.com/watch',
      http: {
        userAgent: 'Chrome test',
        referer: 'https://example.com/player/',
        cookies: 'cf_clearance=token; path=/; domain=.example.com; secure;',
      },
    },
  });
  await tick();

  assert.equal(invocation.executable, 'ffmpeg');
  assert.deepEqual(invocation.args.slice(1, 9), [
    '-user_agent', 'Chrome test',
    '-referer', 'https://example.com/player/',
    '-cookies', 'cf_clearance=token; path=/; domain=.example.com; secure;',
    '-i', 'https://example.com/player/manifest?id=one',
  ]);
});

test('rewrites relative HLS resources against the protected manifest URL', async () => {
  const rewritten = await prepareHlsManifest([
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
    '#EXTINF:4,',
    'segments/one.ts',
  ].join('\n'), 'https://example.com/player/manifest?id=one', {
    validateUrl: async (value) => new URL(value),
  });
  assert.equal(rewritten, [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://example.com/player/keys/key.bin"',
    '#EXTINF:4,',
    'https://example.com/player/segments/one.ts',
  ].join('\n'));
});

test('uses and removes a local browser-captured HLS manifest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-downloader-manifest-test-'));
  let child;
  let invocation;
  const manager = createDownloadManager({
    ffmpegPath: 'ffmpeg',
    downloadsDir: root,
    processFactory: (executable, args) => {
      invocation = { executable, args };
      child = controlledProcess();
      return child;
    },
    verifyOutput: async () => false,
    validateUrl: async (value) => new URL(value),
  });
  const task = manager.create({
    title: 'Captured HLS',
    item: {
      resolver: 'browser',
      directUrl: 'https://example.com/player/manifest?id=one',
      sourceUrl: 'https://example.com/watch',
      manifest: '#EXTM3U\nsegments/one.ts\n',
    },
  });
  for (let attempt = 0; attempt < 100 && !invocation; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.ok(invocation, manager.get(task.id)?.error);
  const inputPath = invocation.args[invocation.args.indexOf('-i') + 1];
  assert.match(inputPath, /\.m3u8$/i);
  assert.equal(await fs.readFile(inputPath, 'utf8'), '#EXTM3U\nhttps://example.com/player/segments/one.ts\n');
  assert.ok(invocation.args.includes('-protocol_whitelist'));

  child.emit('close', 1);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.access(inputPath);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch {
      break;
    }
  }
  await assert.rejects(() => fs.access(inputPath));
  await fs.rm(root, { recursive: true, force: true });
});

test('redacts signed URL queries from failed tasks', async () => {
  let child;
  const manager = createDownloadManager({
    ytDlpPath: 'yt-dlp',
    ffmpegPath: 'ffmpeg',
    downloadsDir: 'C:\\downloads',
    processFactory: () => (child = controlledProcess()),
    verifyOutput: async () => true,
    validateUrl: async (value) => new URL(value),
  });
  const task = manager.create({
    title: 'Clip',
    item: {
      resolver: 'html',
      directUrl: 'https://cdn.example/video.m3u8?auth_key=secret',
      sourceUrl: 'https://example.com/post',
      duration: null,
    },
  });
  await tick();
  child.stderr.write('403 for https://cdn.example/video.m3u8?auth_key=secret\n');
  child.emit('close', 1);
  await tick();
  const failed = manager.get(task.id);
  assert.equal(failed.status, 'failed');
  assert.doesNotMatch(failed.error, /secret/);
  assert.match(failed.error, /redacted/);
});

test('persists public history and marks active tasks interrupted after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'download-history-test-'));
  const historyFile = path.join(root, 'history.json');
  const first = createDownloadManager({
    ytDlpPath: 'yt-dlp',
    downloadsDir: root,
    historyFile,
    processFactory: controlledProcess,
    verifyOutput: async () => true,
  });
  first.create({
    title: 'Private clip',
    item: {
      resolver: 'yt-dlp',
      sourceUrl: 'https://example.com/watch?token=secret',
      duration: 60,
    },
  });
  await tick();

  const raw = await fs.readFile(historyFile, 'utf8');
  assert.doesNotMatch(raw, /example\.com|secret/);

  const restored = createDownloadManager({ downloadsDir: root, historyFile });
  assert.equal(restored.list().length, 1);
  assert.equal(restored.list()[0].status, 'failed');
  assert.match(restored.list()[0].error, /重启.*中断/);
  await fs.rm(root, { recursive: true, force: true });
});

test('limits restored terminal history to 50 and tolerates malformed JSON', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'download-history-limit-'));
  const historyFile = path.join(root, 'history.json');
  const tasks = Array.from({ length: 55 }, (_, index) => ({
    id: `task-${index}`,
    status: 'completed',
    progress: 100,
    speed: null,
    eta: null,
    elapsed: 10,
    title: `Clip ${index}`,
    filename: `clip-${index}.mp4`,
    error: null,
    createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
    completedAt: new Date(2026, 0, 1, 0, index, 10).toISOString(),
  }));
  await fs.writeFile(historyFile, JSON.stringify({ version: 1, tasks }));
  assert.equal(createDownloadManager({ downloadsDir: root, historyFile }).list().length, 50);

  await fs.writeFile(historyFile, '{broken');
  assert.deepEqual(createDownloadManager({ downloadsDir: root, historyFile }).list(), []);
  await fs.rm(root, { recursive: true, force: true });
});

test('removes one completed history task without deleting its output file', async () => {
  let child;
  const manager = createDownloadManager({
    ytDlpPath: 'yt-dlp',
    downloadsDir: 'C:\\downloads',
    processFactory: () => (child = controlledProcess()),
    verifyOutput: async () => true,
  });
  const task = manager.create({
    title: 'Keep the file',
    item: { resolver: 'yt-dlp', sourceUrl: 'https://example.com/watch' },
  });
  await tick();
  child.emit('close', 0);
  await waitUntil(() => manager.get(task.id).status === 'completed');

  assert.equal(manager.removeHistory(task.id), true);
  assert.equal(manager.get(task.id), null);
  assert.equal(manager.removeHistory(task.id), false);
});
