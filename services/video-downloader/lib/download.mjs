import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { normalizePublicUrl, sanitizeFilename } from './security.mjs';
import { probeMedia, separateSubtitles, textSubtitleStreams } from './subtitles.mjs';

const HISTORY_VERSION = 1;
const HISTORY_LIMIT = 50;
const MAX_HLS_MANIFEST_BYTES = 2_000_000;

export async function prepareHlsManifest(manifest, baseUrl, {
  validateUrl = normalizePublicUrl,
  lookup,
} = {}) {
  const source = String(manifest ?? '');
  if (Buffer.byteLength(source) > MAX_HLS_MANIFEST_BYTES || !source.trimStart().startsWith('#EXTM3U')) {
    throw new Error('Browser HLS manifest is invalid or too large.');
  }

  const resolveUri = async (value) => {
    const absolute = new URL(value, baseUrl).href;
    return (await validateUrl(absolute, { lookup })).href;
  };
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || /^\s*#/.test(line)) {
      const matches = [...line.matchAll(/\bURI="([^"]+)"/g)];
      for (const match of matches.reverse()) {
        const absolute = await resolveUri(match[1]);
        const start = match.index + match[0].indexOf(match[1]);
        lines[index] = `${lines[index].slice(0, start)}${absolute}${lines[index].slice(start + match[1].length)}`;
      }
      continue;
    }
    lines[index] = await resolveUri(line.trim());
  }
  return lines.join('\n');
}

export function parseYtDlpProgress(line) {
  const match = String(line).trim().match(/^download:\s*([\d.]+)%\|([^|]*)\|([^|]*)$/i);
  if (!match) return null;
  return {
    progress: Math.min(100, Math.max(0, Number(match[1]))),
    speed: match[2].trim() || null,
    eta: match[3].trim() || null,
  };
}

export function parseFfmpegDuration(value) {
  const match = String(value).match(/Duration:\s*(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)/i);
  if (!match) return null;
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}

export function parseFfmpegProgress(block, duration) {
  const values = {};
  for (const line of String(block).split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  if (values.progress === 'end') {
    return { progress: 100, speed: null, eta: null, elapsed: null };
  }
  const microseconds = Number(values.out_time_ms);
  if (!Number.isFinite(microseconds) && !values.speed) return null;
  const elapsed = Number.isFinite(microseconds) ? microseconds / 1_000_000 : null;
  const progress = Number(duration) > 0 && elapsed !== null
    ? Math.min(99, Math.max(0, (elapsed / Number(duration)) * 100))
    : 0;
  return {
    progress: Math.round(progress * 10) / 10,
    speed: values.speed || null,
    eta: null,
    elapsed,
  };
}

function redactError(value) {
  return String(value || 'Download failed.')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, '$1?redacted')
    .slice(-2_000);
}

function publicTask(task) {
  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    speed: task.speed,
    eta: task.eta,
    elapsed: task.elapsed,
    title: task.title,
    filename: task.filename,
    error: task.error,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    subtitles: task.subtitles ?? [],
    subtitleStatus: task.subtitleStatus ?? 'unchecked',
    subtitleWarning: task.subtitleWarning ?? '',
  };
}

function loadHistory(filename) {
  if (!filename) return [];
  try {
    const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (value?.version !== HISTORY_VERSION || !Array.isArray(value.tasks)) return [];
    return value.tasks.filter((task) => (
      task && typeof task.id === 'string' && typeof task.title === 'string'
    ));
  } catch {
    return [];
  }
}

function saveHistory(filename, tasks) {
  if (!filename) return;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify({ version: HISTORY_VERSION, tasks }, null, 2)}\n`, 'utf8');
}

async function defaultVerifyOutput(filename) {
  try {
    const stat = await fs.promises.stat(filename);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function addChunkLines(onLine) {
  let pending = '';
  return (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  };
}

export function createDownloadManager({
  ytDlpPath,
  ffmpegPath,
  ffprobePath = 'ffprobe',
  probe = probeMedia,
  subtitleProcessor = separateSubtitles,
  downloadsDir,
  processFactory = spawn,
  verifyOutput = defaultVerifyOutput,
  validateUrl = normalizePublicUrl,
  lookup,
  maxConcurrent = 2,
  maxPending = 20,
  taskTimeoutMs = 10 * 60_000,
  maxFileBytes = 500 * 1024 * 1024,
  sizeCheckMs = 1000,
  subtitleLanguages = 'en.*,zh.*,-live_chat',
  historyFile,
} = {}) {
  const tasks = new Map();
  const queue = [];
  let active = 0;

  function uniqueFilename(title) {
    const base = sanitizeFilename(title);
    let candidate = `${base}.mp4`;
    let suffix = 2;
    const inUse = () => {
      const stem = path.basename(candidate, '.mp4');
      let siblings = [];
      try { siblings = fs.readdirSync(downloadsDir); } catch {}
      return siblings.some(name => name === candidate || name.startsWith(`${stem}.`))
        || [...tasks.values()].some(task => task.filename === candidate);
    };
    while (inUse()) candidate = `${base} (${suffix++}).mp4`;
    return candidate;
  }

  function trimTasks() {
    const terminal = [...tasks.values()]
      .filter((task) => ['completed', 'failed'].includes(task.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    while (terminal.length > HISTORY_LIMIT) tasks.delete(terminal.shift().id);
  }

  function taskForClient(task) {
    const value = publicTask(task);
    return {
      ...value,
      fileAvailable: task.status === 'completed'
        && fs.existsSync(path.join(downloadsDir, task.filename)),
      subtitles: value.subtitles.map(subtitle => ({
        ...subtitle, fileAvailable: task.status === 'completed'
          && fs.existsSync(path.join(downloadsDir, subtitle.filename)),
      })),
    };
  }

  function persist() {
    try {
      saveHistory(historyFile, [...tasks.values()].map(publicTask));
    } catch (error) {
      console.warn(`Could not save download history: ${error.message}`);
    }
  }

  async function removeTemporaryInput(task) {
    const filename = task.temporaryInput;
    task.temporaryInput = null;
    if (filename) await fs.promises.rm(filename, { force: true }).catch(() => {});
  }

  let restoredInterrupted = false;
  for (const record of loadHistory(historyFile)) {
    const wasActive = ['queued', 'downloading', 'processing', 'paused'].includes(record.status);
    const restored = {
      id: record.id,
      status: wasActive ? 'failed' : (record.status === 'completed' ? 'completed' : 'failed'),
      progress: Number.isFinite(Number(record.progress)) ? Number(record.progress) : 0,
      speed: record.speed ? String(record.speed) : null,
      eta: record.eta ? String(record.eta) : null,
      elapsed: Number.isFinite(Number(record.elapsed)) ? Number(record.elapsed) : null,
      title: sanitizeFilename(record.title),
      filename: sanitizeFilename(record.filename || 'video.mp4'),
      subtitles: Array.isArray(record.subtitles) ? record.subtitles.filter(file =>
        typeof file.filename === 'string' && file.filename.endsWith('.srt')
        && sanitizeFilename(file.filename) === file.filename).map(file => ({
        filename: file.filename, language: sanitizeFilename(file.language || 'und'),
      })) : [],
      subtitleStatus: ['available', 'none', 'unavailable'].includes(record.subtitleStatus) ? record.subtitleStatus : 'unchecked',
      subtitleWarning: String(record.subtitleWarning || '').slice(0, 1000),
      error: wasActive ? '下载器重启，任务已中断。' : (record.error ? String(record.error) : null),
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
      completedAt: wasActive
        ? new Date().toISOString()
        : (typeof record.completedAt === 'string' ? record.completedAt : null),
      item: null,
      child: null,
      temporaryInput: null,
      running: false,
      pauseRequested: false,
      resumeRequested: false,
    };
    restoredInterrupted ||= wasActive;
    tasks.set(restored.id, restored);
  }
  trimTasks();
  if (restoredInterrupted) persist();

  function releasePausedTask(task) {
    task.child = null;
    task.running = false;
    task.pauseRequested = false;
    active -= 1;
    if (task.resumeRequested) {
      task.resumeRequested = false;
      task.status = 'queued';
      queue.push(task);
    }
    persist();
    queueMicrotask(pump);
  }

  async function run(task) {
    task.running = true;
    task.status = 'downloading';
    task.error = null;
    persist();
    const finalPath = path.join(downloadsDir, task.filename);
    let outputPath = finalPath;
    let executable;
    let args;

    if (task.item.resolver === 'yt-dlp') {
      if (!ytDlpPath) throw new Error('yt-dlp is not available.');
      executable = ytDlpPath;
      args = [
        '--ignore-config',
        '--socket-timeout', '20',
        '--retries', '2',
        '--fragment-retries', '2',
        '--max-filesize', String(maxFileBytes),
        '--write-subs', '--write-auto-subs', '--sub-langs', subtitleLanguages,
        '--sub-format', 'srt/vtt/ass/best', '--convert-subs', 'srt',
        '--ignore-errors',
        ...(ffmpegPath && path.isAbsolute(ffmpegPath) ? ['--ffmpeg-location', ffmpegPath] : []),
        '--newline',
        '--no-playlist',
        '--merge-output-format', 'mp4',
        '--remux-video', 'mp4',
        '--progress-template', 'download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
        '--output', outputPath,
        '--', task.item.sourceUrl,
      ];
    } else {
      if (!ffmpegPath) throw new Error('FFmpeg is not available.');
      if (!task.item.directUrl) throw new Error('Direct media URL is missing.');
      const directUrl = await validateUrl(task.item.directUrl, { lookup });
      if (task.pauseRequested) {
        releasePausedTask(task);
        return;
      }
      executable = ffmpegPath;
      const http = task.item.http ?? {};
      const userAgent = String(http.userAgent || 'Mozilla/5.0 LocalVideoDownloader/1.0')
        .replace(/[\r\n]/g, '');
      const referer = String(http.referer || task.item.sourceUrl).replace(/[\r\n]/g, '');
      const cookies = String(http.cookies || '').replace(/\r/g, '');
      let input = directUrl.href;
      if (task.item.manifest) {
        const manifest = await prepareHlsManifest(task.item.manifest, directUrl.href, {
          validateUrl,
          lookup,
        });
        task.temporaryInput = path.join(downloadsDir, `.video-downloader-${task.id}.m3u8`);
        await fs.promises.writeFile(task.temporaryInput, manifest, { encoding: 'utf8', flag: 'wx' });
        input = task.temporaryInput;
      }
      const inputArgs = [
        '-user_agent', userAgent, '-referer', referer,
        ...(cookies ? ['-cookies', cookies] : []),
        ...(task.temporaryInput ? ['-protocol_whitelist', 'file,http,https,tcp,tls,crypto'] : []),
      ];
      let tracks = [];
      try {
        const metadata = await probe(input, { ffprobePath, inputArgs, timeoutMs: 45_000, onProcess: child => { task.child = child; } });
        const textTracks = textSubtitleStreams(metadata);
        tracks = textTracks.slice(0, 8);
        const notices = [];
        if ((metadata.streams ?? []).filter(stream => stream.codec_type === 'subtitle').length > textTracks.length) {
          notices.push('含图片或不支持的字幕，这些轨道无法直接分离为 SRT。');
        }
        if (textTracks.length > 8) notices.push('字幕轨较多，本次最多导出 8 条。');
        task.subtitleWarning = notices.join(' ');
      } catch {
        task.subtitleWarning = '源字幕检测失败，视频会继续下载；无法确认是否包含可分离字幕。';
      }
      if (task.pauseRequested) { await removeTemporaryInput(task); releasePausedTask(task); return; }
      if (tracks.length) outputPath = path.join(downloadsDir, `.source-${task.id}.mkv`);
      args = [
        '-y',
        '-user_agent', userAgent,
        '-referer', referer,
        ...(cookies ? ['-cookies', cookies] : []),
        ...(task.temporaryInput
          ? ['-protocol_whitelist', 'file,http,https,tcp,tls,crypto']
          : []),
        '-i', input,
        '-map', '0:v?',
        '-map', '0:a?',
        ...tracks.flatMap(track => ['-map', `0:${track.index}`]),
        '-c', 'copy',
        ...(tracks.length ? ['-c:s', 'srt'] : ['-movflags', '+faststart']),
        '-progress', 'pipe:1',
        '-nostats',
        outputPath,
      ];
    }

    const child = processFactory(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    task.child = child;
    let stderr = '';
    let ffmpegBlock = '';
    let ffmpegDuration = Number(task.item.duration) > 0 ? Number(task.item.duration) : null;
    let settled = false;
    let limitError = null;
    const timeout = setTimeout(() => {
      limitError = new Error('下载超过时限，已停止；请使用更短的片段。');
      child.kill?.();
    }, taskTimeoutMs);
    timeout.unref?.();
    const sizeTimer = setInterval(async () => {
      if (settled) return;
      try {
        const names = await fs.promises.readdir(downloadsDir);
        const name = path.basename(outputPath);
        let total = 0;
        const stem = path.basename(name, path.extname(name));
        for (const entry of names.filter(entry => entry === name || entry.startsWith(`${stem}.`))) {
          const stat = await fs.promises.stat(path.join(downloadsDir, entry));
          if (stat.isFile()) total += stat.size;
        }
        if (!settled && total > maxFileBytes) {
          limitError = new Error('下载文件超过容量限制，已停止；请使用更小的片段。');
          child.kill?.();
        }
      } catch { /* Temporary outputs can disappear while remuxing. */ }
    }, sizeCheckMs);
    sizeTimer.unref?.();

    if (task.item.resolver === 'yt-dlp') {
      child.stdout?.on('data', addChunkLines((line) => {
        const update = parseYtDlpProgress(line);
        if (update) Object.assign(task, update);
      }));
    } else {
      child.stdout?.on('data', (chunk) => {
        ffmpegBlock = (ffmpegBlock + chunk.toString()).slice(-8_192);
        const update = parseFfmpegProgress(ffmpegBlock, ffmpegDuration);
        if (update) Object.assign(task, update);
      });
    }
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8_192);
      if (task.item.resolver !== 'yt-dlp') {
        ffmpegDuration ??= parseFfmpegDuration(stderr);
      }
    });

    const finish = async (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(sizeTimer);
      error = limitError ?? error;
      if (!error && code === 0) {
        const stat = await fs.promises.stat(outputPath).catch(() => null);
        if (stat && stat.size > maxFileBytes) error = new Error('下载文件超过容量限制，已停止；请使用更小的片段。');
      }
      await removeTemporaryInput(task);
      if (task.pauseRequested) {
        releasePausedTask(task);
        return;
      }
      task.child = null;
      let valid = !error && code === 0 && await verifyOutput(outputPath);
      if (valid && fs.existsSync(outputPath)) {
        task.status = 'processing';
        task.subtitleStatus = 'extracting';
        persist();
        try {
          const initialWarning = task.subtitleWarning;
          const result = await subtitleProcessor(outputPath, finalPath, {
            ffmpegPath: ffmpegPath || 'ffmpeg', ffprobePath, maxFileBytes,
            onProcess: child => { task.child = child; },
          });
          Object.assign(task, result);
          task.subtitleWarning = [initialWarning, result.subtitleWarning].filter(Boolean).join(' ');
          if (task.subtitleWarning && !task.subtitles.length) task.subtitleStatus = 'unavailable';
          valid = await verifyOutput(finalPath);
          if (valid && outputPath !== finalPath) await fs.promises.rm(outputPath, { force: true });
        } catch {
          task.subtitles = [];
          task.subtitleStatus = 'unavailable';
          task.subtitleWarning = '字幕分离失败，请检查 FFprobe/FFmpeg 或源字幕。';
          valid = outputPath === finalPath && await verifyOutput(finalPath);
          if (!valid) error = new Error('视频已下载，但视频与字幕分离失败，请检查源字幕或 FFmpeg。');
        }
      }
      task.child = null;
      task.running = false;
      if (valid) {
        let totalBytes = (await fs.promises.stat(finalPath).catch(() => null))?.size ?? 0;
        for (const subtitle of task.subtitles) totalBytes += (await fs.promises.stat(path.join(downloadsDir, subtitle.filename)).catch(() => null))?.size ?? 0;
        if (totalBytes > maxFileBytes) {
          valid = false;
          error = new Error('视频与字幕输出超过容量限制。');
        }
      }
      if (valid) {
        task.status = 'completed';
        task.progress = 100;
        task.speed = null;
        task.eta = null;
        task.completedAt = new Date().toISOString();
      } else {
        task.status = 'failed';
        task.error = redactError(error?.message || stderr.trim() || `Downloader exited with code ${code}.`);
        task.completedAt = new Date().toISOString();
      }
      active -= 1;
      trimTasks();
      persist();
      queueMicrotask(pump);
    };

    child.on('error', (error) => void finish(error, null));
    child.on('close', (code) => void finish(null, code));
  }

  function pump() {
    while (active < maxConcurrent && queue.length) {
      const task = queue.shift();
      active += 1;
      run(task).catch(async (error) => {
        await removeTemporaryInput(task);
        if (task.pauseRequested) {
          releasePausedTask(task);
          return;
        }
        task.child = null;
        task.running = false;
        task.status = 'failed';
        task.error = redactError(error.message);
        task.completedAt = new Date().toISOString();
        active -= 1;
        trimTasks();
        persist();
        queueMicrotask(pump);
      });
    }
  }

  return {
    create({ title, item }) {
      if (!item || !item.sourceUrl) throw new Error('A resolved media item is required.');
      const pending = [...tasks.values()].filter(task => ['queued', 'downloading', 'processing', 'paused'].includes(task.status));
      if (pending.length >= maxPending) {
        throw new Error('下载任务已满，请等待现有任务完成后再试。');
      }
      const task = {
        id: crypto.randomUUID(),
        status: 'queued',
        progress: 0,
        speed: null,
        eta: null,
        elapsed: null,
        title: sanitizeFilename(title || item.title || 'video'),
        filename: uniqueFilename(title || item.title || 'video'),
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        subtitles: [],
        subtitleStatus: 'unchecked',
        subtitleWarning: '',
        item,
        child: null,
        temporaryInput: null,
        running: false,
        pauseRequested: false,
        resumeRequested: false,
      };
      tasks.set(task.id, task);
      queue.push(task);
      persist();
      queueMicrotask(pump);
      return taskForClient(task);
    },

    get(id) {
      const task = tasks.get(id);
      return task ? taskForClient(task) : null;
    },

    list() {
      return [...tasks.values()].reverse().map(taskForClient);
    },

    pause(id) {
      const task = tasks.get(id);
      if (!task) return null;
      if (!['queued', 'downloading'].includes(task.status)) {
        throw new Error('Only queued or active downloads can be paused.');
      }
      task.status = 'paused';
      task.speed = null;
      task.eta = null;
      if (task.running) {
        task.pauseRequested = true;
        task.child?.kill();
      } else {
        const index = queue.indexOf(task);
        if (index >= 0) queue.splice(index, 1);
      }
      persist();
      return taskForClient(task);
    },

    resume(id) {
      const task = tasks.get(id);
      if (!task) return null;
      if (task.status !== 'paused') throw new Error('Only paused downloads can be resumed.');
      if (task.running) {
        task.resumeRequested = true;
      } else {
        if (task.item?.resolver !== 'yt-dlp') {
          task.progress = 0;
          task.elapsed = null;
        }
        task.status = 'queued';
        task.error = null;
        queue.push(task);
        queueMicrotask(pump);
      }
      persist();
      return taskForClient(task);
    },

    clearHistory() {
      for (const [id, task] of tasks) {
        if (['completed', 'failed'].includes(task.status)) tasks.delete(id);
      }
      persist();
    },

    removeHistory(id) {
      const task = tasks.get(id);
      if (!task || !['completed', 'failed'].includes(task.status)) return false;
      tasks.delete(id);
      persist();
      return true;
    },
  };
}
