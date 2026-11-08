import fs from 'node:fs/promises';
import path from 'node:path';
import { separateSubtitles } from '../lib/subtitles.mjs';
import { sanitizeFilename } from '../lib/security.mjs';

const [input, directory] = process.argv.slice(2);
if (!input || !directory) throw new Error('用法：node scripts/separate-subtitles.mjs "视频文件" "新的输出文件夹"');
const inputPath = path.resolve(input);
const root = path.resolve(directory);
// A new directory prevents accidentally replacing a user's existing video/subtitles.
await fs.mkdir(root, { recursive: false });
const outputPath = path.join(root, `${sanitizeFilename(path.basename(inputPath, path.extname(inputPath)))}.mp4`);
const result = await separateSubtitles(inputPath, outputPath, {
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg', ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
});
console.log(JSON.stringify({ video: outputPath, ...result }, null, 2));
