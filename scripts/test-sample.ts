/** Validate the paired demo. Requires FFmpeg/ffprobe; optional argument: source SRT. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { extractMp4Subtitles } from '../lib/demux/mp4';
import { trackToSrt } from '../lib/demux';
import { parseSubtitle } from '../lib/subtitle';
import sample from '../public/sample/manchester-repair-v2.json';

async function main() {
  const videoPath = `public${sample.video}`;
  const srt = fs.readFileSync(`public${sample.subtitle}`, 'utf8');
  const expected = parseSubtitle(srt);
  assert.equal(createHash('sha256').update(srt).digest('hex'), sample.subtitleSha256);
  assert.equal(expected.length, 16);
  assert.equal(expected[0].text, 'You need a new stopper.');
  assert.equal(expected[0].start, 0);
  assert.equal(expected.at(-1)?.text, "it's really up to you.");
  assert.equal(expected.at(-1)?.end, 38.405);
  assert(expected.every(cue => cue.native && cue.end > cue.start));
  for (let i = 0; i < expected.length; i++) {
    const cue = expected[i];
    const source = sample.cues[i];
    assert.equal(cue.text, source.text);
    assert.equal(Math.round(cue.start * 1000), Math.round(source.start * 1000));
    assert.equal(Math.round(cue.end * 1000), Math.round(source.end * 1000));
    assert.equal(Math.round((source.sourceStart - sample.sourceStart) * 1000), Math.round(cue.start * 1000));
    assert.equal(Math.round((source.sourceEnd - sample.sourceStart) * 1000), Math.round(cue.end * 1000));
  }

  const tracks = await extractMp4Subtitles(new File([fs.readFileSync(videoPath)], 'sample.mp4'));
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].codec, 'tx3g');
  assert.deepEqual(parseSubtitle(trackToSrt(tracks[0])), expected);
  const ffmpegSrt = execFileSync('ffmpeg', ['-v', 'error', '-i', videoPath, '-map', '0:s:0', '-f', 'srt', '-'], { encoding: 'utf8' });
  assert.deepEqual(parseSubtitle(ffmpegSrt), expected);

  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt,color_transfer,channels,start_time,duration:format=duration', '-of', 'json', videoPath], { encoding: 'utf8' }));
  const video = metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
  const audio = metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === 'audio');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.equal(video.color_transfer, 'bt709');
  assert.equal(audio.codec_name, 'aac');
  assert.equal(audio.channels, 2);
  assert(Math.abs(Number(video.start_time) - Number(audio.start_time)) <= 0.042);
  assert(Number(video.start_time) <= 0.042);
  assert(Math.abs(Number(metadata.format.duration) - sample.duration) <= 0.1);

  if (process.argv[2]) {
    const source = parseSubtitle(fs.readFileSync(process.argv[2], 'utf8'));
    for (const cue of sample.cues) {
      assert(source.some(original => Math.round(original.start * 1000) === Math.round(cue.sourceStart * 1000) && Math.round(original.end * 1000) === Math.round(cue.sourceEnd * 1000) && original.text === cue.text));
    }
    console.log('All 16 source cues match the original SRT exactly.');
  }
  console.log('PASS: paired SRT, embedded subtitles and FFmpeg agree; video/audio share the cut origin.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
