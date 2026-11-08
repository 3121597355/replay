/** Run the real resolve -> download -> file retrieval pipeline in an isolated directory. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';
import { createDownloadManager } from '../lib/download.mjs';
import { resolveMedia } from '../lib/resolve.mjs';

const sourceUrl = process.argv[2];
assert(sourceUrl, 'Usage: node scripts/smoke.mjs https://your-public-video.mp4 [report.json]');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-downloader-smoke-'));
const manager = createDownloadManager({
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ytDlpPath: process.env.YTDLP_PATH,
  downloadsDir: root,
  historyFile: path.join(root, 'history.json'),
  taskTimeoutMs: 60000,
});
const server = createServer({
  downloadsDir: root,
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
  resolver: url => resolveMedia(url, { ytDlpPath: process.env.YTDLP_PATH, browserResolver: null }),
  downloadManager: manager,
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (pathname, body) => {
  const response = await fetch(base + pathname, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  return result;
};
try {
  const resolved = await post('/api/resolve', { url: sourceUrl });
  assert.equal(resolved.items.length, 1);
  const created = await post('/api/downloads', { sourceUrl, itemId: resolved.items[0].id, title: 'Replay 实际下载验证' });
  let task;
  const deadline = Date.now() + 65000;
  do {
    await new Promise(resolve => setTimeout(resolve, 300));
    task = await (await fetch(`${base}/api/downloads/${created.id}`)).json();
  } while (!['completed', 'failed'].includes(task.status) && Date.now() < deadline);
  assert.equal(task.status, 'completed', task.error ?? 'Download did not finish');
  const filename = path.join(root, task.filename);
  assert.equal(path.dirname(path.resolve(filename)), path.resolve(root));
  const bytes = await fs.readFile(filename);
  const response = await fetch(base + task.fileUrl);
  assert.equal(response.status, 200);
  const served = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(served, bytes);
  const metadata = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration,size', '-of', 'json', filename,
  ], { encoding: 'utf8', windowsHide: true }));
  assert(metadata.streams.some(stream => stream.codec_type === 'video'));
  assert(metadata.streams.some(stream => stream.codec_type === 'audio'));
  const report = {
    result: 'pass', sourceUrl, status: task.status, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), metadata,
    verified: ['real FFmpeg download', 'completed task status', 'file bytes agree', 'video and audio streams'],
  };
  if (process.argv[3]) await fs.writeFile(process.argv[3], JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  for (const task of manager.list()) {
    if (task.status === 'downloading' || task.status === 'queued') manager.pause(task.id);
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  // Leave the isolated outputs in the scratch directory for audit, never touch user downloads.
}
