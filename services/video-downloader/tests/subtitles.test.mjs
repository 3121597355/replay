import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { textSubtitleStreams, listSrtFiles, runMediaCommand } from '../lib/subtitles.mjs';

test('distinguishes extractable text tracks from bitmap and unknown subtitles', () => {
  const streams = [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 1, codec_type: 'subtitle', codec_name: 'mov_text' },
    { index: 2, codec_type: 'subtitle', codec_name: 'ass' },
    { index: 3, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle' },
    { index: 4, codec_type: 'subtitle', codec_name: 'unknown' },
  ];
  assert.deepEqual(textSubtitleStreams({ streams }).map(s => s.index), [1, 2]);
});

test('only offers valid SRT sidecars paired with this video filename', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-files-'));
  try {
    await fs.writeFile(path.join(root, 'Clip.en.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHello\n');
    await fs.writeFile(path.join(root, 'Other.en.srt'), '1\n00:00:01,000 --> 00:00:02,000\nWrong video\n');
    await fs.writeFile(path.join(root, 'Clip.zh.srt'), '');
    const files = await listSrtFiles(path.join(root, 'Clip.mp4'));
    assert.deepEqual(files.map(f => f.filename), ['Clip.en.srt']);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('stops a stalled subtitle process and rejects excessive final output', async () => {
  const child = () => {
    const process = new EventEmitter();
    process.stdout = new PassThrough(); process.stderr = new PassThrough();
    process.kill = () => process.emit('close', 1);
    return process;
  };
  await assert.rejects(runMediaCommand('ffprobe', [], { processFactory: child, timeoutMs: 20 }), /超时/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-limit-'));
  try {
    const output = path.join(root, 'output.srt');
    await fs.writeFile(output, Buffer.alloc(9));
    await assert.rejects(runMediaCommand('ffmpeg', [], {
      processFactory: () => { const p = child(); setImmediate(() => p.emit('close', 0)); return p; },
      outputPaths: [output], maxFileBytes: 8,
    }), /容量/);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
