/**
 * 纯 JS 的 MKV / WebM 字幕提取。
 *
 * MKV 是 EBML 格式，每个元素都是「ID + 长度 + 内容」。
 * 结构大致：
 *
 *   EBML_header
 *   Segment
 *     Info           TimecodeScale（时间单位，默认 1000000ns = 1ms）
 *     Tracks
 *       TrackEntry   TrackNumber / TrackType(0x11=字幕) / CodecID
 *     Cluster        若干个，每个带一个 Timecode
 *       SimpleBlock  真正的数据：track号 + 相对时间 + flags + 内容
 *
 * 关键优化：非字幕的 block 只读 header 就 skip，内容一个字节都不读。
 * 所以 14GB 的原盘也能跑，代价基本只是顺序扫一遍容器。
 */

import type { DemuxedCue, DemuxedTrack } from './mp4';

/** EBML 元素 ID */
const ID = {
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  Language: 0x22b59c,
  CodecPrivate: 0x63a2,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ContentCompression: 0x5034,
} as const;

/** TrackType = 0x11 表示字幕 */
const TRACK_TYPE_SUBTITLE = 0x11;

/**
 * 一次读多少进内存。
 *
 * 这个值直接影响速度，而且反直觉：**越大越慢**。
 *
 * cluster 里 99% 是视频数据，我们读到 block 头就 skip 掉内容。
 * 如果 chunk 是 4MB，每个 cluster 开头都会先读 4MB 垃圾；
 * 缩到 64KB，一次读只覆盖几个 block 头，跳过的数据根本不进内存。
 * 14.6GB 的原盘实测从 165 秒降到十几秒。
 */
const CHUNK = 64 * 1024;

const TE = new TextDecoder('utf-8');

/** 分块读文件的游标 */
class Reader {
  private buf = new Uint8Array(0);
  /** buf 在文件里的起点 */
  private base = 0;
  /** buf 内的当前位置 */
  pos = 0;

  constructor(private file: File) {}

  /** 文件内绝对偏移 */
  get offset() {
    return this.base + this.pos;
  }

  get eof() {
    return this.offset >= this.file.size;
  }

  /** 保证 buffer 里至少还有 n 字节 */
  async ensure(n: number): Promise<boolean> {
    if (this.pos + n <= this.buf.length) return true;
    const from = this.base + this.pos;
    if (from >= this.file.size) return false;
    const take = Math.max(n, CHUNK);
    const to = Math.min(from + take, this.file.size);
    const ab = await this.file.slice(from, to).arrayBuffer();
    this.buf = new Uint8Array(ab);
    this.base = from;
    this.pos = 0;
    return this.buf.length >= n;
  }

  /** 取 n 个字节，不前进 */
  peek(n: number): Uint8Array {
    return this.buf.subarray(this.pos, this.pos + n);
  }

  /** 前进 n 字节。跨出 buffer 时不读数据，直接把游标推到文件里。 */
  skip(n: number) {
    if (n <= 0) return;
    if (this.pos + n <= this.buf.length) {
      this.pos += n;
    } else {
      this.base += this.pos + n;
      this.pos = 0;
      this.buf = new Uint8Array(0);
    }
  }

  /** 读 n 字节内容 */
  bytes(n: number): Uint8Array {
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

function readId(buf: Uint8Array, pos: number): { id: number; len: number } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 4 && !(first & mask)) {
    mask >>= 1;
    len++;
  }
  if (len > 4 || pos + len > buf.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { id, len };
}

function readVint(
  buf: Uint8Array,
  pos: number
): { value: number; len: number; unknown: boolean } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || pos + len > buf.length) return null;

  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < len; i++) {
    const b = buf[pos + i];
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  // 长度全 1 表示「未知大小」，Segment 常见
  return { value, len, unknown: allOnes };
}

function readUint(buf: Uint8Array): number {
  let v = 0;
  for (let i = 0; i < buf.length; i++) v = v * 256 + buf[i];
  return v;
}

function readInt16(buf: Uint8Array, pos: number): number {
  const v = (buf[pos] << 8) | buf[pos + 1];
  return v & 0x8000 ? v - 0x10000 : v;
}

/** 读一个元素的头（ID + 长度），内容留给调用方 */
async function readHeader(
  r: Reader
): Promise<{ id: number; size: number; unknown: boolean; headerLen: number } | null> {
  if (!(await r.ensure(12))) return null;
  const head = r.peek(12);
  const idr = readId(head, 0);
  if (!idr) return null;
  const sz = readVint(head, idr.len);
  if (!sz) return null;
  r.skip(idr.len + sz.len);
  return { id: idr.id, size: sz.value, unknown: sz.unknown, headerLen: idr.len + sz.len };
}

interface SubTrackInfo {
  number: number;
  codec: string;
  lang?: string;
  privateData?: Uint8Array;
}

/** 解析 Tracks，挑出字幕轨 */
async function readTracks(r: Reader, size: number): Promise<SubTrackInfo[]> {
  const out: SubTrackInfo[] = [];
  const start = r.offset;
  const end = size === 0 ? Infinity : start + size;

  while (r.offset < end) {
    const h = await readHeader(r);
    if (!h) break;
    if (h.id !== ID.TrackEntry) {
      r.skip(h.size);
      continue;
    }

    const entryStart = r.offset;
    const entryEnd = entryStart + h.size;
    let number = 0;
    let type = 0;
    let codec = '';
    let lang: string | undefined;
    let privateData: Uint8Array | undefined;

    while (r.offset < entryEnd) {
      const eh = await readHeader(r);
      if (!eh) break;
      if (eh.id === ID.TrackNumber) {
        if (await r.ensure(eh.size)) number = readUint(r.bytes(eh.size));
        else r.skip(eh.size);
      } else if (eh.id === ID.TrackType) {
        if (await r.ensure(eh.size)) type = readUint(r.bytes(eh.size));
        else r.skip(eh.size);
      } else if (eh.id === ID.CodecID) {
        if (await r.ensure(eh.size)) codec = TE.decode(r.bytes(eh.size)).replace(/\0+$/, '');
        else r.skip(eh.size);
      } else if (eh.id === ID.Language) {
        if (await r.ensure(eh.size)) lang = TE.decode(r.bytes(eh.size)).replace(/\0+$/, '');
        else r.skip(eh.size);
      } else if (eh.id === ID.CodecPrivate) {
        if (await r.ensure(eh.size)) privateData = new Uint8Array(r.bytes(eh.size));
        else r.skip(eh.size);
      } else if (eh.id === ID.ContentCompression) {
        // 有压缩的话解起来麻烦，先标记成不支持
        codec = `${codec}|compressed`;
        r.skip(eh.size);
      } else {
        r.skip(eh.size);
      }
    }

    if (type === TRACK_TYPE_SUBTITLE && number > 0) {
      out.push({ number, codec, lang, privateData });
    }
  }

  return out;
}

/**
 * 解一个 SimpleBlock / Block。
 * 返回 null 表示这不是我们要的轨，内容已跳过。
 */
async function readBlock(
  r: Reader,
  size: number,
  subTracks: Map<number, SubTrackInfo>,
  clusterTime: number,
  timeScale: number,
  onCue: (trackNo: number, start: number, text: string) => void
): Promise<void> {
  const blockStart = r.offset;

  // 至少要有 track vint(1-8) + int16 + flags(1)
  if (!(await r.ensure(Math.min(size, 12)))) {
    r.skip(size);
    return;
  }

  const head = r.peek(Math.min(size, 12));
  const tn = readVint(head, 0);
  if (!tn) {
    r.skip(size);
    return;
  }

  const isSub = subTracks.has(tn.value);
  if (!isSub) {
    // 不是字幕：内容一个字节都不读
    r.skip(size);
    return;
  }

  const relTime = readInt16(head, tn.len);
  const flags = head[tn.len + 2];
  const lacing = (flags & 0x06) >> 1;
  const headerLen = tn.len + 3;

  // 字幕轨基本不带 lacing；带了就放弃这条，别读出脏数据
  if (lacing !== 0) {
    r.skip(size);
    return;
  }

  const payloadLen = size - headerLen;
  if (payloadLen <= 0) {
    r.skip(size);
    return;
  }

  if (!(await r.ensure(size))) {
    r.skip(size);
    return;
  }
  r.skip(headerLen);
  const payload = new Uint8Array(r.bytes(payloadLen));

  const info = subTracks.get(tn.value)!;
  let text = '';

  if (info.codec.startsWith('S_TEXT/UTF8') || info.codec.startsWith('S_TEXT/ASCII')) {
    text = TE.decode(payload).replace(/\0+$/, '').trim();
  } else if (info.codec.startsWith('S_TEXT/ASS') || info.codec.startsWith('S_TEXT/SSA')) {
    // ASS 的 body：ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    const raw = TE.decode(payload).replace(/\0+$/, '');
    const parts = raw.split(',');
    text = parts.length >= 9 ? parts.slice(8).join(',') : raw;
    // 去掉 {\...} 覆盖标签
    text = text.replace(/\{[^}]*\}/g, '');
    // \N 是换行
    text = text.replace(/\\N/g, '\n').replace(/\\n/g, '\n');
    text = text.trim();
  } else {
    r.skip(0);
  }

  if (text) {
    const start = (clusterTime + relTime) * timeScale;
    onCue(tn.value, start, text);
  }

  void blockStart;
}

/**
 * 探测是不是 mkv/webm。
 * EBML magic：1A 45 DF A3
 */
export async function canHandleMkv(file: File): Promise<boolean> {
  if (file.size < 4) return false;
  const ab = await file.slice(0, 4).arrayBuffer();
  const b = new Uint8Array(ab);
  return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
}

/** 提取 mkv 里的字幕轨 */
export async function extractMkvSubtitles(
  file: File,
  onProgress?: (pct: number) => void
): Promise<DemuxedTrack[]> {
  const r = new Reader(file);
  const subTracks = new Map<number, SubTrackInfo>();
  /** trackNo -> 原始 cue 列表 */
  const collected = new Map<number, DemuxedCue[]>();
  let timeScale = 1; // ms，等 Info 里覆盖
  let inSegment = false;
  let guard = 0;

  const onCue = (trackNo: number, start: number, text: string) => {
    if (!collected.has(trackNo)) collected.set(trackNo, []);
    collected.get(trackNo)!.push({ start, end: start + 2, text });
  };

  // 顶层：跳过 EBML header，进 Segment
  while (!r.eof && guard++ < 64) {
    const h = await readHeader(r);
    if (!h) break;
    if (h.id === ID.Segment) {
      inSegment = true;
      break; // 进到 Segment 内部继续
    }
    r.skip(h.size);
  }

  if (!inSegment) return [];

  // Segment 内部
  while (!r.eof && guard++ < 5000000) {
    const h = await readHeader(r);
    if (!h) break;

    if (h.id === ID.Info) {
      const start = r.offset;
      const end = start + h.size;
      while (r.offset < end) {
        const ih = await readHeader(r);
        if (!ih) break;
        if (ih.id === ID.TimecodeScale) {
          if (await r.ensure(ih.size)) {
            const ns = readUint(r.bytes(ih.size));
            // 默认 1000000ns；换算成「每单位多少秒」
            if (ns > 0) timeScale = ns / 1e9;
          } else r.skip(ih.size);
        } else {
          r.skip(ih.size);
        }
      }
    } else if (h.id === ID.Tracks) {
      const tracks = await readTracks(r, h.size);
      for (const t of tracks) subTracks.set(t.number, t);
      if (subTracks.size === 0) return []; // 没字幕轨，没必要继续扫
    } else if (h.id === ID.Cluster) {
      const clusterStart = r.offset;
      const clusterEnd = h.unknown ? file.size : clusterStart + h.size;
      let clusterTime = 0;

      while (r.offset < clusterEnd && !r.eof) {
        const ch = await readHeader(r);
        if (!ch) break;

        if (ch.id === ID.Timecode) {
          if (await r.ensure(ch.size)) clusterTime = readUint(r.bytes(ch.size));
          else r.skip(ch.size);
        } else if (ch.id === ID.SimpleBlock) {
          await readBlock(r, ch.size, subTracks, clusterTime, timeScale, onCue);
        } else if (ch.id === ID.BlockGroup) {
          // BlockGroup 内部有 Block；结构简单化处理
          const bgEnd = r.offset + ch.size;
          while (r.offset < bgEnd) {
            const bh = await readHeader(r);
            if (!bh) break;
            if (bh.id === ID.Block) {
              await readBlock(r, bh.size, subTracks, clusterTime, timeScale, onCue);
            } else {
              r.skip(bh.size);
            }
          }
        } else {
          r.skip(ch.size);
        }
      }

      if (file.size > 0) {
        onProgress?.(Math.min(99, Math.round((r.offset / file.size) * 100)));
      }
    } else {
      r.skip(h.size);
    }
  }

  onProgress?.(100);

  // 组装
  const out: DemuxedTrack[] = [];
  let idx = 0;
  subTracks.forEach((info, trackNo) => {
    const cues = collected.get(trackNo);
    if (!cues || cues.length === 0) return;

    // 补结束时间：下一条的开始，最后一条给 +3 秒
    for (let i = 0; i < cues.length; i++) {
      const next = cues[i + 1];
      cues[i].end = next && next.start > cues[i].start ? next.start : cues[i].start + 3;
    }

    out.push({
      index: idx++,
      streamIndex: trackNo,
      codec: info.codec,
      lang: info.lang,
      cues,
    });
  });

  return out;
}
