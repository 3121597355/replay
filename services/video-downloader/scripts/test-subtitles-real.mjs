import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { probeMedia, separateSubtitles } from '../lib/subtitles.mjs';
import { createDownloadManager } from '../lib/download.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-real-'));
const run = args => execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-v', 'error', ...args], { windowsHide: true });
const en = '1\n00:00:01,200 --> 00:00:01,900\nFirst line.\n\n2\n00:00:02,300 --> 00:00:03,100\nSecond line.\n';
const zh = en.replace('First line.', '第一句。').replace('Second line.', '第二句。');
await fs.writeFile(path.join(root, 'en.srt'), en);
await fs.writeFile(path.join(root, 'zh.srt'), zh);
const original = path.join(root, 'two-tracks.mp4');
run([
  '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=4',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
  '-i', path.join(root, 'en.srt'), '-i', path.join(root, 'zh.srt'),
  '-map', '0:v', '-map', '1:a', '-map', '2:s', '-map', '3:s',
  '-c:v', 'libx264', '-c:a', 'aac', '-c:s', 'mov_text',
  '-metadata:s:s:0', 'language=eng', '-metadata:s:s:1', 'language=zho', original,
]);
const offset = path.join(root, 'offset.mp4');
run(['-i', original, '-map', '0', '-c', 'copy', '-output_ts_offset', '5', offset]);
const sourceMetadata = await probeMedia(offset);
assert(Number(sourceMetadata.format.start_time) >= 4.9, 'Fixture must have a nonzero source time origin');
const ass = path.join(root, 'styled.mkv');
run(['-i', original, '-map', '0', '-c', 'copy', '-c:s', 'ass', ass]);
const normalize = text => text.replace(/\r/g, '').trim();
const parse = text => normalize(text).split(/\n\s*\n/).map(block => {
  const lines = block.split('\n');
  const ms = value => {
    const [h, m, s, f] = value.split(/[:,]/).map(Number);
    return h * 3600000 + m * 60000 + s * 1000 + f;
  };
  const [start, end] = lines[1].split(' --> ').map(ms);
  return { start, end, text: lines.slice(2).join('\n').replace(/<[^>]*>/g, '') };
});
async function verify(result, output) {
  assert.equal(result.subtitleStatus, 'available');
  assert.equal(result.subtitles.length, 2);
  const metadata = await probeMedia(output);
  assert(metadata.streams.some(s => s.codec_type === 'video'));
  assert(metadata.streams.some(s => s.codec_type === 'audio'));
  assert(!metadata.streams.some(s => s.codec_type === 'subtitle'));
  assert(Math.abs(Number(metadata.format.start_time)) < 0.03, 'Video origin must be normalized with subtitles');
  const videoStartMs = Math.round(Number(metadata.streams.find(s => s.codec_type === 'video').start_time || 0) * 1000);
  for (const file of result.subtitles) {
    const content = await fs.readFile(path.join(path.dirname(output), file.filename), 'utf8');
    const actual = parse(content).map(cue => ({ ...cue, start: cue.start - videoStartMs, end: cue.end - videoStartMs }));
    assert.deepEqual(actual, parse(file.language === 'eng' ? en : zh), 'Subtitle timestamps relative to the first video frame and all text must agree');
  }
}
for (const [label, source] of [['offset', offset], ['ass', ass]]) {
  const target = path.join(root, `${label}-split.mp4`);
  await verify(await separateSubtitles(source, target), target);
}
// Real direct-download pipeline: HTTP input -> source capture -> split -> durable history.
const server = http.createServer((req, res) => { res.setHeader('content-type', 'video/mp4'); createReadStream(offset).pipe(res); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const directory = path.join(root, 'downloads'); await fs.mkdir(directory);
  const historyFile = path.join(directory, 'history.json');
  const manager = createDownloadManager({
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg', downloadsDir: directory, historyFile,
    // The only source is the fixture HTTP server above, deliberately trusted for this test.
    validateUrl: async url => new URL(url),
  });
  const url = `http://127.0.0.1:${server.address().port}/offset.mp4`;
  const created = manager.create({ title: 'Download', item: { resolver: 'html', directUrl: url, sourceUrl: url } });
  const deadline = Date.now() + 15_000;
  let task;
  do {
    await new Promise(resolve => setTimeout(resolve, 25));
    task = manager.get(created.id);
  } while (!['completed', 'failed'].includes(task.status) && Date.now() < deadline);
  assert.equal(task.status, 'completed', task.error);
  await verify(task, path.join(directory, task.filename));
  const restored = createDownloadManager({ downloadsDir: directory, historyFile }).get(task.id);
  assert.equal(restored.subtitles.length, 2);
  assert(restored.subtitles.every(s => s.fileAvailable));
  const noSubs = path.join(root, 'no-subs.mp4');
  run(['-i', original, '-map', '0:v', '-map', '0:a', '-c', 'copy', noSubs]);
  const none = await separateSubtitles(noSubs, path.join(root, 'none-output.mp4'));
  assert.equal(none.subtitleStatus, 'none'); assert.equal(none.subtitles.length, 0);
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ result: 'pass', verified: [
  'two-language MP4 text tracks', 'ASS to SRT', 'nonzero video/subtitle time origin',
  'actual HTTP download and subtitle separation', 'video/audio-only MP4', 'subtitle history survives restart', 'no-subtitle video',
] }));
