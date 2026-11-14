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
    // Limit source time before slowing down: four source seconds become eight seconds.
    const output = path.join(temp, `${clip.slug}.mp4`);
    ffmpeg(['-ss', String(source.start), '-t', String(films.sourceSeconds), '-i', input,
      '-map', '0:v:0', '-an', '-sn', '-vf',
      `setpts=(PTS-STARTPTS)/${films.playbackRate},scale=640:360:force_original_aspect_ratio=increase,crop=640:360,setsar=1,fps=12`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', output]);
    ffmpeg(['-i', output, '-frames:v', '1', '-q:v', '4', path.join(outputDir, `${clip.slug}.jpg`)]);
    const motionImage = path.join(outputDir, `${clip.slug}.webp`);
    ffmpeg(['-i', output, '-an', '-sn', '-c:v', 'libwebp_anim', '-lossless', '0',
      '-compression_level', '4', '-q:v', '42', '-loop', '0', motionImage]);
    console.log(JSON.stringify({ title: clip.title, seconds: films.sourceSeconds / films.playbackRate,
      playbackRate: films.playbackRate, width: 640, height: 360, fps: 12, bytes: fs.statSync(motionImage).size }));
  }
} finally {
  const relative = path.relative(tempBase, path.resolve(temp));
  if (!relative.startsWith('..') && !path.isAbsolute(relative) && relative.startsWith('replay-home-montage-')) {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
