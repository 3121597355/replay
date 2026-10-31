/**
 * 浏览器端字幕抽取。
 *
 * 关键点：全程在本机完成，视频不会上传。
 * ffmpeg.wasm 只做「读容器 → 拿字幕轨 → 转 srt」，不解码画面，所以很快。
 */

export interface SubtitleTrack {
  /** 字幕流在「字幕流列表」里的序号，对应 -map 0:s:N */
  trackIndex: number;
  /** 全局流序号，如 2 表示 Stream #0:2 */
  streamIndex: number;
  lang?: string;
  codec: string;
  raw: string;
}

export type ExtractStage =
  /** 纯 JS 扫容器（毫秒级，不需要下载引擎） */
  | { stage: 'scanning'; pct: number }
  | { stage: 'loading'; pct: number }
  | { stage: 'probing' }
  | { stage: 'extracting' }
  | { stage: 'done' };

type FFmpegLike = {
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>;
  exec: (args: string[]) => Promise<number>;
  writeFile: (name: string, data: Uint8Array) => Promise<boolean>;
  readFile: (name: string) => Promise<Uint8Array | string>;
  deleteFile: (name: string) => Promise<boolean>;
  createDir: (path: string) => Promise<boolean>;
  mount: (
    fsType: string,
    options: { files?: File[]; blobs?: { name: string; data: Blob }[] },
    mountPoint: string
  ) => Promise<boolean>;
  unmount: (mountPoint: string) => Promise<boolean>;
  on: (event: 'log' | 'progress', cb: (p: any) => void) => void;
  off: (event: 'log' | 'progress', cb: (p: any) => void) => void;
  terminate: () => void;
  loaded: boolean;
};

/** 已知的 core wasm 体积（@ffmpeg/core 0.12.x 约 31MB），拿不到 content-length 时用它估 */
const WASM_EST_BYTES = 31 * 1024 * 1024;

/**
 * 带进度的 toBlobURL。
 *
 * ffmpeg 官方的 toBlobURL 内部也是 fetch，但不吐进度——
 * 首次要下 31MB 的 wasm，界面上只有一个卡在 0% 的进度条，
 * 用户会以为卡死了。这里自己读 ReadableStream。
 */
async function toBlobURLWithProgress(
  url: string,
  mimeType: string,
  onPct: (pct: number) => void,
  estBytes?: number
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  // 跨域没暴露 content-length 时用估算值兜底
  const headerTotal = Number(res.headers.get('content-length') ?? 0);
  const total = headerTotal > 0 ? headerTotal : (estBytes ?? 0);

  if (!res.body) {
    const blob = await res.blob();
    onPct(100);
    return URL.createObjectURL(blob);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastPct = -1;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.length;
    if (total > 0) {
      // 估算模式下不要到 100，留给真正完成
      const raw = (received / total) * 100;
      const pct = Math.round(headerTotal > 0 ? Math.min(100, raw) : Math.min(99, raw));
      if (pct !== lastPct) {
        lastPct = pct;
        onPct(pct);
      }
    }
  }

  onPct(100);
  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type: mimeType }));
}

/** 超过这个大小就走 WORKERFS 挂载，而不是读进内存 */
const DIRECT_WRITE_LIMIT = 300 * 1024 * 1024; // 300MB
const MOUNT_POINT = '/mnt';

const CDN_BASES = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
  'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
];

let instance: FFmpegLike | null = null;
let loadingPromise: Promise<FFmpegLike> | null = null;
let activeBase = CDN_BASES[0];

interface InputHandle {
  /** 传给 ffmpeg 的输入路径 */
  path: string;
  /** 用完必须调用，释放内存或卸载 */
  release: () => Promise<void>;
}

/**
 * 把文件交给 ffmpeg，两种方式：
 *
 *  小文件 → writeFile 拷进 MEMFS（快）
 *  大文件 → WORKERFS 挂载（file 对象按需读取，不进内存）
 *
 * 后者是关键：14GB 的 4K 原盘也能处理，因为数据始终留在磁盘上。
 */
async function openInput(file: File, ff: FFmpegLike): Promise<InputHandle> {
  if (file.size > DIRECT_WRITE_LIMIT) {
    // 用固定文件名挂载，规避中文/空格在虚拟文件系统里的不确定性
    const ext = extOf(file.name);
    const safeName = `input${ext}`;
    const safe = new File([file], safeName, { type: file.type || 'video/*' });

    try {
      await ff.createDir(MOUNT_POINT).catch(() => {
        /* 目录已存在 */
      });
      await ff.mount('WORKERFS', { files: [safe] }, MOUNT_POINT);
    } catch (err) {
      throw new Error(
        `挂载文件失败（${
          err instanceof Error ? err.message : '未知原因'
        }）。这个浏览器可能不支持大文件流式读取。`
      );
    }

    return {
      path: `${MOUNT_POINT}/${safeName}`,
      release: async () => {
        try {
          await ff.unmount(MOUNT_POINT);
        } catch {
          /* 忽略 */
        }
      },
    };
  }

  const name = `__src${extOf(file.name)}`;
  await ff.writeFile(name, await readFileBytes(file));
  return {
    path: name,
    release: async () => {
      try {
        await ff.deleteFile(name);
      } catch {
        /* 忽略 */
      }
    },
  };
}

/**
 * 懒加载 ffmpeg.wasm。首次要下 ~31MB 的 core，之后走浏览器缓存。
 */
export async function loadFFmpeg(
  onStage?: (s: ExtractStage) => void
): Promise<FFmpegLike> {
  if (instance?.loaded) return instance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');

    let lastErr: unknown;

    for (const base of CDN_BASES) {
      const ff = new FFmpeg() as unknown as FFmpegLike;
      try {
        onStage?.({ stage: 'loading', pct: 0 });

        // core.js 只有一百多 KB，占进度不到 1%，先下载但不报数
        const coreURL = await toBlobURLWithProgress(
          `${base}/ffmpeg-core.js`,
          'text/javascript',
          () => {}
        );

        // wasm 有 31MB，这才是用户要等的
        const wasmURL = await toBlobURLWithProgress(
          `${base}/ffmpeg-core.wasm`,
          'application/wasm',
          (pct) => onStage?.({ stage: 'loading', pct }),
          WASM_EST_BYTES
        );

        await ff.load({ coreURL, wasmURL });

        activeBase = base;
        instance = ff;
        return ff;
      } catch (err) {
        lastErr = err;
        try {
          ff.terminate();
        } catch {
          /* 忽略 */
        }
      }
    }

    loadingPromise = null;
    throw new Error(
      `ffmpeg 加载失败（${activeBase}）。${
        lastErr instanceof Error ? lastErr.message : ''
      }`
    );
  })();

  return loadingPromise;
}

const STREAM_RE =
  /Stream #0:(\d+)(?:\[0x[0-9a-fA-F]+\])?(?:\(([^)]+)\))?: Subtitle: ([a-zA-Z0-9_]+)/g;

/**
 * 探测视频里的字幕轨。用 ffmpeg -i 的日志解析，不需要 ffprobe。
 */
export async function probeSubtitleTracks(
  file: File,
  ff: FFmpegLike,
  onStage?: (s: ExtractStage) => void
): Promise<SubtitleTrack[]> {
  const logs: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    logs.push(message);
  };

  onStage?.({ stage: 'probing' });

  const input = await openInput(file, ff);
  ff.on('log', onLog);
  try {
    try {
      // 没有输出文件必然失败，但我们要的就是它打印的输入流信息
      await ff.exec(['-i', input.path]);
    } catch {
      /* 预期失败 */
    }
    // 日志是 worker 通过 postMessage 异步送回来的，给一拍让它落地
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    ff.off('log', onLog);
    await input.release();
  }

  const joined = logs.join('\n');
  const tracks: SubtitleTrack[] = [];
  let m: RegExpExecArray | null;
  let order = 0;
  STREAM_RE.lastIndex = 0;
  while ((m = STREAM_RE.exec(joined)) !== null) {
    tracks.push({
      trackIndex: order++,
      streamIndex: Number(m[1]),
      lang: m[2],
      codec: m[3].trim(),
      raw: m[0],
    });
  }
  return tracks;
}

/**
 * 抽取指定字幕轨，返回 srt 文本。
 */
export async function extractSubtitle(
  file: File,
  trackIndex: number,
  ff: FFmpegLike,
  onStage?: (s: ExtractStage) => void
): Promise<string> {
  const output = '__out.srt';

  onStage?.({ stage: 'extracting' });

  const input = await openInput(file, ff);
  try {
    const code = await ff.exec([
      '-i',
      input.path,
      '-map',
      `0:s:${trackIndex}`,
      '-c:s',
      'srt',
      output,
    ]);
    if (code !== 0) {
      // 有些容器（如 mp4 里的 mov_text）要先显式选中字幕流
      const retry = await ff.exec([
        '-i',
        input.path,
        '-map',
        '0:s',
        '-c:s',
        'srt',
        output,
      ]);
      if (retry !== 0) throw new Error('这条字幕轨抽不出来，可能不是文本字幕');
    }

    const data = await ff.readFile(output);
    const text =
      typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);

    if (!text || text.trim().length === 0) {
      throw new Error('抽出的是空字幕');
    }
    return text;
  } finally {
    await input.release();
    try {
      await ff.deleteFile(output);
    } catch {
      /* 忽略 */
    }
  }
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '.bin';
}

/**
 * 读文件内容时统一兜底。
 *
 * 浏览器原生的 NotReadableError 长这样：
 *   "The requested file could not be read, typically due to permission
 *    problems that have occurred after a reference to a file was acquired."
 * 直接弹给用户等于没说，所以翻译成人话 + 给可操作的建议。
 */
export async function readFileBytes(
  file: File,
  onStage?: (s: ExtractStage) => void
): Promise<Uint8Array> {
  onStage?.({ stage: 'probing' });
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e?.name === 'NotReadableError') {
      throw new Error(
        '读不到这个文件。常见原因：还在云盘里没下载完（OneDrive 占位文件）、被别的程序占着、或者在网络盘上。把它复制到本地硬盘（比如桌面）再试。'
      );
    }
    if (e?.name === 'SecurityError') {
      throw new Error('浏览器不允许读取这个位置的文件。换个目录，或者用「选择文件」重新选一次。');
    }
    if (/allocation|memory|out of memory/i.test(e?.message ?? '')) {
      throw new Error(
        '文件太大，浏览器内存不够。建议先截取一小段（比如前 20 分钟）再试。'
      );
    }
    throw new Error(`读取文件失败：${e?.message ?? '未知原因'}`);
  }
}

/** 选完文件立刻探一下可读性，别等用户点抽字幕才发现问题 */
export async function canRead(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

export function trackLabel(t: SubtitleTrack): string {
  const lang = t.lang ? langName(t.lang) : '未标注语言';
  return `${lang} · ${t.codec}`;
}

function langName(code: string): string {
  const map: Record<string, string> = {
    eng: '英语',
    en: '英语',
    chi: '中文',
    zho: '中文',
    zh: '中文',
    chs: '简体中文',
    cht: '繁体中文',
    jpn: '日语',
    jp: '日语',
    kor: '韩语',
    ko: '韩语',
    fre: '法语',
    fra: '法语',
    ger: '德语',
    deu: '德语',
    spa: '西班牙语',
  };
  return map[code.toLowerCase()] ?? code.toUpperCase();
}
