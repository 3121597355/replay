import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeFilename } from './security.mjs';

const TEXT_CODECS = new Set([
  'subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'microdvd',
  'sami', 'realtext', 'subviewer', 'subviewer1', 'vplayer', 'jacosub',
]);
export function textSubtitleStreams(metadata) {
  return (metadata?.streams ?? []).filter(stream =>
    stream.codec_type === 'subtitle' && TEXT_CODECS.has(stream.codec_name));
}

export function runMediaCommand(executable, args, {
  timeoutMs = 60_000, processFactory = spawn, onProcess = () => {},
  outputPaths = [], maxFileBytes = 500 * 1024 * 1024,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = processFactory(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    onProcess(child);
    let stdout = '', stderr = '', failure, settled = false;
    const stop = error => { failure ??= error; child.kill?.(); };
    const timer = setTimeout(() => stop(new Error('字幕处理超时，已停止。')), timeoutMs);
    const checkSize = async () => {
      let total = 0;
      for (const filename of outputPaths) {
        const stat = await fs.stat(filename).catch(() => null);
        total += stat?.size ?? 0;
      }
      if (total > maxFileBytes) throw new Error('字幕处理输出超过容量限制。');
    };
    const sizeTimer = setInterval(() => {
      if (!settled) void checkSize().catch(stop);
    }, 250);
    child.stdout?.on('data', data => {
      stdout += data.toString();
      if (Buffer.byteLength(stdout) > 1024 * 1024) stop(new Error('字幕检测结果过大。'));
    });
    child.stderr?.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
    const finish = async (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearInterval(sizeTimer); onProcess(null);
      try {
        if (failure || error || code !== 0) throw failure || error || new Error(`字幕处理失败：${stderr.trim() || code}`);
        await checkSize();
        resolve(stdout);
      } catch (error) { reject(error); }
    };
    child.once('error', error => void finish(error));
    child.once('close', code => void finish(null, code));
  });
}

export async function probeMedia(input, { ffprobePath = 'ffprobe', inputArgs = [], ...options } = {}) {
  const json = await runMediaCommand(ffprobePath, [
    '-v', 'error', ...inputArgs, '-show_streams', '-show_format', '-of', 'json', input,
  ], options);
  const result = JSON.parse(json);
  if (!Array.isArray(result.streams)) throw new Error('无法读取媒体轨道。');
  return result;
}

export async function listSrtFiles(outputPath) {
  const root = path.dirname(outputPath);
  const stem = path.basename(outputPath, path.extname(outputPath));
  const names = await fs.readdir(root).catch(() => []);
  const result = [];
  for (const name of names.filter(name => name.startsWith(`${stem}.`) && name.endsWith('.srt')).slice(0, 20)) {
    const full = path.join(root, name);
    const stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024) continue;
    const content = await fs.readFile(full, 'utf8');
    if (!/\d\d:\d\d:\d\d,\d{3}\s*-->\s*\d\d:\d\d:\d\d,\d{3}/.test(content)) continue;
    result.push({ filename: name, language: name.slice(stem.length + 1, -4).replace(/\.\d+$/, ''), bytes: stat.size });
  }
  return result;
}

/** Export text tracks and a video/audio-only MP4 from the same local time origin. */
export async function separateSubtitles(inputPath, outputPath, {
  ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', metadata,
  maxTracks = 8, ...options
} = {}) {
  metadata ??= await probeMedia(inputPath, { ffprobePath, ...options });
  const allSubs = metadata.streams.filter(stream => stream.codec_type === 'subtitle');
  const textTracks = textSubtitleStreams(metadata);
  const tracks = textTracks.slice(0, maxTracks);
  const warnings = [];
  if (allSubs.length > textTracks.length) warnings.push('含图片字幕，无法直接转为 SRT，需要 OCR 识别。');
  if (textTracks.length > maxTracks) warnings.push(`字幕轨较多，本次最多导出 ${maxTracks} 条。`);
  const root = path.dirname(outputPath);
  const stem = path.basename(outputPath, path.extname(outputPath));
  const replacing = path.resolve(inputPath) === path.resolve(outputPath);
  const videoTarget = replacing ? path.join(root, `.split-${crypto.randomUUID()}.mp4`) : outputPath;
  const files = tracks.map(track => {
    const language = sanitizeFilename(track.tags?.language || 'und').replace(/[^\w-]/g, '_').slice(0, 24);
    return { filename: `${stem}.${language}.${track.index}.srt`, language, index: track.index };
  });
  const remux = !replacing || allSubs.length > 0;
  const videoArgs = ['-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'disabled', '-movflags', '+faststart', videoTarget];
  const subtitleArgs = files.flatMap(file => ['-map', `0:${file.index}`, '-c:s', 'srt', path.join(root, file.filename)]);
  try {
    if (remux || files.length) {
      try {
        await runMediaCommand(ffmpegPath, [
          '-y', '-v', 'error', '-copyts', '-start_at_zero', '-i', inputPath,
          ...(remux ? videoArgs : []), ...subtitleArgs,
        ], { ...options, outputPaths: [...(remux ? [videoTarget] : []), ...files.map(file => path.join(root, file.filename))] });
      } catch (error) {
        // Keep the video usable even when a damaged text track cannot be converted.
        warnings.push('部分字幕转换失败，已保留视频；请检查源字幕。');
        for (const file of files) await fs.rm(path.join(root, file.filename), { force: true });
        if (remux) await runMediaCommand(ffmpegPath, [
          '-y', '-v', 'error', '-copyts', '-start_at_zero', '-i', inputPath, ...videoArgs,
        ], { ...options, outputPaths: [videoTarget] });
      }
      if (remux && replacing) await fs.rename(videoTarget, outputPath);
    }
  } finally {
    if (replacing) await fs.rm(videoTarget, { force: true }).catch(() => {});
  }
  const subtitles = await listSrtFiles(outputPath);
  return {
    subtitles, subtitleStatus: subtitles.length ? 'available' : (warnings.length ? 'unavailable' : 'none'),
    subtitleWarning: warnings.join(' '),
  };
}
