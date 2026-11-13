import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// node scripts/build-home-montage.mjs <directory containing slug.mp4 source files>
// Missing source files are fetched from the public preview URLs in the manifest.
const root = fileURLToPath(new URL('../', import.meta.url));
const sources = JSON.parse(fs.readFileSync(new URL('./home-montage-sources.json', import.meta.url), 'utf8'));
const sourceDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'replay-home-montage-sources'));
const outputDir = path.join(root, 'public/home');
const tempBase = path.resolve(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempBase, 'replay-home-montage-'));
const clipSeconds = 4;
const fadeSeconds = 0.55;
const sceneSeconds = clipSeconds - fadeSeconds;
fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 4_000_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `ffmpeg exited ${result.status}`);
}

try {
  for (const [index, source] of sources.entries()) {
    const input = path.join(sourceDir, `${source.slug}.mp4`);
    if (!fs.existsSync(input)) {
      const response = await fetch(source.media, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`${source.slug}: HTTP ${response.status}`);
      fs.writeFileSync(input, Buffer.from(await response.arrayBuffer()));
    }
    ffmpeg(['-ss', String(source.start), '-i', input, '-t', String(clipSeconds),
      '-map', '0:v:0', '-an', '-sn', '-vf', 'scale=768:432:force_original_aspect_ratio=increase,crop=768:432,setsar=1,fps=24',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', path.join(temp, `${index}.mp4`)]);
    console.log(`Prepared ${source.title}`);
  }
  // Repeat the first clip for the last dissolve, then trim at matching frames.
  const count = sources.length;
  const inputs = [...sources.keys(), 0].flatMap(index => ['-i', path.join(temp, `${index}.mp4`)]);
  const filters = [];
  for (let index = 0; index <= count; index++) {
    filters.push(`[${index}:v]settb=AVTB,setpts=PTS-STARTPTS[v${index}]`);
  }
  for (let index = 1; index <= count; index++) {
    const previous = index === 1 ? 'v0' : `mix${index - 1}`;
    filters.push(`[${previous}][v${index}]xfade=transition=fade:duration=${fadeSeconds}:offset=${(sceneSeconds * index).toFixed(2)}[mix${index}]`);
  }
  const end = sceneSeconds * count + fadeSeconds;
  filters.push(`[mix${count}]trim=start=${fadeSeconds}:end=${end.toFixed(2)},setpts=PTS-STARTPTS[out]`);
  const output = path.join(temp, 'film-loop.mp4');
  ffmpeg([...inputs, '-filter_complex_threads', '1', '-filter_complex', filters.join(';'), '-map', '[out]',
    '-an', '-sn', '-c:v', 'libx264', '-preset', 'slow', '-crf', '29', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
  ffmpeg(['-ss', '0.1', '-i', output, '-frames:v', '1', '-q:v', '4', path.join(outputDir, 'film-poster.jpg')]);
  const motionImage = path.join(outputDir, 'film-loop.webp');
  ffmpeg(['-i', output, '-an', '-sn', '-vf', 'scale=640:360,setsar=1,fps=12',
    '-c:v', 'libwebp_anim', '-lossless', '0', '-compression_level', '6', '-q:v', '42', '-loop', '0', motionImage]);
  console.log(JSON.stringify({ seconds: Number((sceneSeconds * count).toFixed(2)), width: 640, height: 360, fps: 12, bytes: fs.statSync(motionImage).size }));
} finally {
  const relative = path.relative(tempBase, path.resolve(temp));
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && relative.startsWith('replay-home-montage-')) {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
