import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// node scripts/build-home-montage.mjs <directory containing slug.mp4 source files>
// Missing source files are fetched from the public preview URLs in the manifest.
const root = fileURLToPath(new URL('../', import.meta.url));
const sources = JSON.parse(fs.readFileSync(new URL('./home-montage-sources.json', import.meta.url), 'utf8'));
const films = JSON.parse(fs.readFileSync(new URL('../lib/home-films.json', import.meta.url), 'utf8'));
const sourceDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'replay-home-montage-sources'));
const outputDir = path.join(root, 'public/home');
const tempBase = path.resolve(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempBase, 'replay-home-montage-'));
fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 4_000_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `ffmpeg exited ${result.status}`);
}

function probe(args) {
  const result = spawnSync('ffprobe', ['-v', 'error', ...args, '-of', 'json'], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 4_000_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

try {
  for (const clip of films.clips) {
    const source = sources.find(source => source.slug === clip.slug);
    if (!source || source.title !== clip.title || source.originalTitle !== clip.originalTitle) {
      throw new Error(`Source and display metadata differ: ${clip.slug}`);
    }
    const input = path.join(sourceDir, `${source.slug}.mp4`);
    if (!fs.existsSync(input)) {
      const response = await fetch(source.media, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`${source.slug}: HTTP ${response.status}`);
      fs.writeFileSync(input, Buffer.from(await response.arrayBuffer()));
    }
    const size = probe(['-select_streams', 'v:0', '-show_entries', 'stream=width,height', input]).streams[0];
    if (size.width < films.width || size.height < films.height) throw new Error(`Use an HD source for ${clip.slug}`);
    // Annex-B frames are packaged as canvas-only data, without a playable media container.
    const output = path.join(temp, `${clip.slug}.h264`);
    ffmpeg(['-ss', String(source.start), '-t', String(films.sourceSeconds), '-i', input,
      '-map', '0:v:0', '-an', '-sn', '-vf',
      `setpts=(PTS-STARTPTS)/${films.playbackRate},scale=${films.width}:${films.height}:force_original_aspect_ratio=increase,crop=${films.width}:${films.height},setsar=1,fps=${films.fps}`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '25', '-profile:v', 'baseline', '-level:v', '3.1',
      '-bf', '0', '-g', String(films.fps), '-keyint_min', String(films.fps), '-sc_threshold', '0',
      '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-f', 'h264', output]);
    ffmpeg(['-i', output, '-frames:v', '1', '-q:v', '2', path.join(outputDir, `${clip.slug}.jpg`)]);
    const payload = fs.readFileSync(output);
    const packets = probe(['-show_packets', '-show_entries', 'packet=pos,size,flags', output]).packets;
    let profile;
    for (let i = 0; i < Math.min(payload.length - 7, 4096); i++) {
      if (payload[i] === 0 && payload[i + 1] === 0 && payload[i + 2] === 1 && (payload[i + 3] & 31) === 7) {
        profile = payload.subarray(i + 4, i + 7).toString('hex'); break;
      }
    }
    if (!profile || packets.length < films.sourceSeconds * films.fps - 2) throw new Error(`Incomplete film: ${clip.slug}`);
    const metadata = Buffer.from(JSON.stringify({ codec: `avc1.${profile}`, width: films.width,
      height: films.height, fps: films.fps, frames: packets.map(p => [Number(p.pos), Number(p.size), p.flags.includes('K') ? 1 : 0]) }));
    const header = Buffer.alloc(12); header.write('RPLYM001'); header.writeUInt32LE(metadata.length, 8);
    const motion = path.join(outputDir, `${clip.slug}.rpl`);
    fs.writeFileSync(motion, Buffer.concat([header, metadata, payload]));
    console.log(JSON.stringify({ title: clip.title, seconds: packets.length / films.fps,
      playbackRate: films.playbackRate, width: films.width, height: films.height, fps: films.fps,
      bytes: fs.statSync(motion).size, codec: `avc1.${profile}` }));
  }
} finally {
  const relative = path.relative(tempBase, path.resolve(temp));
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && relative.startsWith('replay-home-montage-')) {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
