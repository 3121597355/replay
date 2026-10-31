/**
 * 纯 JS 的 MP4 / MOV 字幕提取。
 *
 * 为什么要自己写：ffmpeg.wasm 有 31MB，其中 99% 是编解码器，
 * 而我们只需要「读容器 → 找字幕轨 → 解出文本」，一个编解码器都用不上。
 *
 * MP4 的结构是一棵 box 树：
 *
 *   moov
 *     trak                 每个轨道一个
 *       mdia
 *         mdhd             时间刻度（timescale）
 *         hdlr             handler：sbtl/subt/text 才是字幕
 *         minf/stbl        样本表：把「第几个样本」映射到「文件里哪个字节」
 *           stsd           样本描述，看 codec 是不是 tx3g
 *           stts / stsz / stsc / stco
 *   mdat                   真正的数据
 *
 * 拿到样本偏移后按需 slice 文件，不把整个视频读进内存。
 */

export interface DemuxedCue {
  start: number;
  end: number;
  text: string;
}

export interface DemuxedTrack {
  /** 字幕流序号，对应 ffmpeg 的 0:s:N */
  index: number;
  /** 全局流序号，界面显示用 */
  streamIndex: number;
  codec: string;
  lang?: string;
  cues: DemuxedCue[];
}

interface Box {
  type: string;
  /** box 起始（含 header） */
  start: number;
  /** box 总长度（含 header） */
  size: number;
  /** header 长度：8、16（largesize）或 0（延伸到末尾） */
  headerSize: number;
}

const TD = new TextDecoder('latin1');
const TE = new TextDecoder('utf-8');

function u32(dv: DataView, off: number): number {
  return dv.getUint32(off, false);
}

function u64(dv: DataView, off: number): number {
  const hi = dv.getUint32(off, false);
  const lo = dv.getUint32(off + 4, false);
  return hi * 4294967296 + lo;
}

function typeAt(dv: DataView, off: number): string {
  // 4 字节 ASCII。latin1 解 4 个字节足够
  return String.fromCharCode(
    dv.getUint8(off),
    dv.getUint8(off + 1),
    dv.getUint8(off + 2),
    dv.getUint8(off + 3)
  );
}

/** 解析一个 box 头 */
function readBox(dv: DataView, off: number, limit: number): Box | null {
  if (off + 8 > limit) return null;
  let size = u32(dv, off);
  const type = typeAt(dv, off + 4);
  let headerSize = 8;

  if (size === 1) {
    if (off + 16 > limit) return null;
    size = u64(dv, off + 8);
    headerSize = 16;
  } else if (size === 0) {
    size = limit - off;
  }

  if (size < headerSize || off + size > limit) return null;
  return { type, start: off, size, headerSize };
}

/** 列出 [from, to) 范围内的直接子 box */
function children(dv: DataView, from: number, to: number): Box[] {
  const out: Box[] = [];
  let off = from;
  while (off < to) {
    const b = readBox(dv, off, to);
    if (!b) break;
    out.push(b);
    off += b.size;
    if (off <= b.start) break; // 防御：size 为 0 的死循环
  }
  return out;
}

function find(dv: DataView, from: number, to: number, type: string): Box | null {
  return children(dv, from, to).find((b) => b.type === type) ?? null;
}

/** box 内容起点（跳过 header） */
function bodyStart(b: Box): number {
  return b.start + b.headerSize;
}

async function readSlice(file: File, start: number, end: number): Promise<DataView> {
  const blob = file.slice(start, Math.min(end, file.size));
  return new DataView(await blob.arrayBuffer());
}

/**
 * 找 moov。
 * 它通常在文件头（faststart）或文件尾，逐个顶层 box 跳过去，不整文件读。
 */
async function findMoov(file: File): Promise<{ dv: DataView; start: number; end: number } | null> {
  let off = 0;
  let guard = 0;

  while (off + 8 <= file.size && guard++ < 512) {
    const head = await readSlice(file, off, off + 16);
    let size = u32(head, 0);
    const type = typeAt(head, 4);
    let headerSize = 8;

    if (size === 1) {
      size = u64(head, 8);
      headerSize = 16;
    } else if (size === 0) {
      size = file.size - off; // 一直到最后
    }
    if (size < headerSize) return null;

    if (type === 'moov') {
      const dv = await readSlice(file, off, off + size);
      return { dv, start: off, end: size };
    }

    off += size;
  }
  return null;
}

interface SampleTable {
  sizes: number[];
  /** 每个样本的 chunk 号（1 起） */
  chunkOf: number[];
  chunkOffsets: number[];
  /** 每个样本的 DTS（秒） */
  dts: number[];
}

/** 解 stts / stsz / stsc / stco，算出每个样本的位置和时间 */
function buildSampleTable(
  dv: DataView,
  stblStart: number,
  stblEnd: number,
  timescale: number
): SampleTable | null {
  const stsz = find(dv, stblStart, stblEnd, 'stsz');
  const stts = find(dv, stblStart, stblEnd, 'stts');
  const stsc = find(dv, stblStart, stblEnd, 'stsc');
  const stco = find(dv, stblStart, stblEnd, 'stco') ?? find(dv, stblStart, stblEnd, 'co64');
  if (!stsz || !stts || !stsc || !stco) return null;

  // ---- sizes ----
  const sz0 = bodyStart(stsz) + 4; // version+flags
  const defaultSize = u32(dv, sz0);
  const count = u32(dv, sz0 + 4);
  const sizes: number[] = [];
  if (defaultSize !== 0) {
    for (let i = 0; i < count; i++) sizes.push(defaultSize);
  } else {
    let p = sz0 + 8;
    for (let i = 0; i < count; i++) {
      sizes.push(u32(dv, p));
      p += 4;
    }
  }

  // ---- 每个样本的 DTS ----
  const ts0 = bodyStart(stts) + 4;
  const tsCount = u32(dv, ts0);
  const dts: number[] = [];
  {
    let p = ts0 + 4;
    let t = 0;
    for (let i = 0; i < tsCount; i++) {
      const n = u32(dv, p);
      const delta = u32(dv, p + 4);
      for (let k = 0; k < n; k++) {
        dts.push(timescale > 0 ? t / timescale : 0);
        t += delta;
      }
      p += 8;
    }
  }

  // ---- stsc：第几个 chunk 装几个样本 ----
  const sc0 = bodyStart(stsc) + 4;
  const scCount = u32(dv, sc0);
  const runs: { firstChunk: number; perChunk: number }[] = [];
  {
    let p = sc0 + 4;
    for (let i = 0; i < scCount; i++) {
      runs.push({ firstChunk: u32(dv, p), perChunk: u32(dv, p + 4) });
      p += 12; // first_chunk, samples_per_chunk, sample_description_index
    }
  }

  // ---- chunk 偏移 ----
  const co0 = bodyStart(stco) + 4;
  const coCount = u32(dv, co0);
  const chunkOffsets: number[] = [];
  {
    const is64 = stco.type === 'co64';
    let p = co0 + 4;
    for (let i = 0; i < coCount; i++) {
      chunkOffsets.push(is64 ? u64(dv, p) : u32(dv, p));
      p += is64 ? 8 : 4;
    }
  }

  // ---- 展开：每个样本属于哪个 chunk ----
  const chunkOf: number[] = [];
  let sampleIdx = 0;
  for (let ci = 0; ci < chunkOffsets.length && sampleIdx < sizes.length; ci++) {
    const chunkNo = ci + 1;
    // 找当前 chunk 落在哪个 run 里
    let perChunk = runs[0]?.perChunk ?? 0;
    for (let r = 0; r < runs.length; r++) {
      if (runs[r].firstChunk <= chunkNo) perChunk = runs[r].perChunk;
      else break;
    }
    for (let k = 0; k < perChunk && sampleIdx < sizes.length; k++) {
      chunkOf.push(ci);
      sampleIdx++;
    }
  }

  return { sizes, chunkOf, chunkOffsets, dts };
}

/** 把样本表还原成「每个样本在文件里的偏移」 */
function sampleOffsets(t: SampleTable): number[] {
  const out: number[] = [];
  let lastChunk = -1;
  let cursor = 0;

  for (let i = 0; i < t.sizes.length; i++) {
    const chunk = t.chunkOf[i];
    if (chunk !== lastChunk) {
      cursor = t.chunkOffsets[chunk] ?? 0;
      lastChunk = chunk;
    }
    out.push(cursor);
    cursor += t.sizes[i];
  }
  return out;
}

/**
 * tx3g（mov_text）样本格式：
 *   [uint16 文本长度][UTF-8 文本][可选样式框]
 * 长度不含它自己那 2 个字节。
 */
function parseTx3g(data: Uint8Array): string {
  if (data.length < 2) return '';
  const len = (data[0] << 8) | data[1];
  const end = Math.min(2 + len, data.length);
  return TE.decode(data.subarray(2, end)).replace(/\u0000/g, '').trim();
}

/** 探测 mp4 是不是这个解析器能处理的 */
export async function canHandleMp4(file: File): Promise<boolean> {
  try {
    const head = await readSlice(file, 0, Math.min(64, file.size));
    if (head.byteLength < 8) return false;
    const t = typeAt(head, 4);
    return t === 'ftyp' || t === 'moov' || t === 'free' || t === 'skip' || t === 'wide';
  } catch {
    return false;
  }
}

/**
 * 提取 mp4 里所有字幕轨。
 * 没有字幕轨返回空数组（不是错误——这部电影就是硬字幕）。
 */
export async function extractMp4Subtitles(
  file: File,
  onProgress?: (pct: number) => void
): Promise<DemuxedTrack[]> {
  onProgress?.(5);
  const moov = await findMoov(file);
  if (!moov) return [];

  const { dv, end } = moov;
  const tracks: DemuxedTrack[] = [];
  const traks = children(dv, bodyStart({ type: 'moov', start: 0, size: end, headerSize: 8 }), end).filter(
    (b) => b.type === 'trak'
  );

  onProgress?.(20);

  let subIndex = 0;
  let streamCounter = 0;

  for (const trak of traks) {
    streamCounter++;
    const mdia = find(dv, bodyStart(trak), bodyStart(trak) + trak.size - trak.headerSize, 'mdia');
    if (!mdia) continue;

    const mdiaStart = bodyStart(mdia);
    const mdiaEnd = mdia.start + mdia.size;

    const hdlr = find(dv, mdiaStart, mdiaEnd, 'hdlr');
    if (!hdlr) continue;
    // hdlr: version+flags(4) + pre_defined(4) + handler_type(4)
    const handler = typeAt(dv, bodyStart(hdlr) + 8);

    // 字幕轨的 handler 通常是 sbtl / subt；
    // text 既可能是 QuickTime 逐字稿字幕，也可能是章节标题轨
    // （mkv 转 mp4 常见，内容是 "22. 场景描述"），要再看 codec 才能定
    if (handler !== 'sbtl' && handler !== 'subt' && handler !== 'text') continue;

    const mdhd = find(dv, mdiaStart, mdiaEnd, 'mdhd');
    let timescale = 1000;
    let lang: string | undefined;
    if (mdhd) {
      const v = dv.getUint8(bodyStart(mdhd));
      // v0: creation(4) modification(4) timescale(4) duration(4) lang(2)
      // v1: creation(8) modification(8) timescale(4) duration(8) lang(2)
      const tsOff = bodyStart(mdhd) + 4 + (v === 1 ? 16 : 8);
      timescale = u32(dv, tsOff) || 1000;
      const langOff = tsOff + 4 + (v === 1 ? 8 : 4);
      if (langOff + 2 <= mdiaEnd) {
        const packed = dv.getUint16(langOff, false);
        if (packed) {
          lang = String.fromCharCode(
            ((packed >> 10) & 0x1f) + 0x60,
            ((packed >> 5) & 0x1f) + 0x60,
            (packed & 0x1f) + 0x60
          );
        }
      }
    }

    const minf = find(dv, mdiaStart, mdiaEnd, 'minf');
    if (!minf) continue;
    const stbl = find(dv, bodyStart(minf), minf.start + minf.size, 'stbl');
    if (!stbl) continue;

    const stblStart = bodyStart(stbl);
    const stblEnd = stbl.start + stbl.size;

    // codec
    const stsd = find(dv, stblStart, stblEnd, 'stsd');
    let codec = 'unknown';
    if (stsd) {
      const entryCountOff = bodyStart(stsd) + 4;
      if (u32(dv, entryCountOff) > 0) {
        codec = typeAt(dv, entryCountOff + 4 + 4); // entry 前 4 字节是 size
      }
    }

    // handler 是 text 的轨，只有 tx3g 才是真字幕；
    // 其余（text 轨但 codec 不是 tx3g）基本都是章节标题，跳过
    if (handler === 'text' && codec !== 'tx3g') continue;

    const table = buildSampleTable(dv, stblStart, stblEnd, timescale);
    if (!table || table.sizes.length === 0) continue;

    const offsets = sampleOffsets(table);
    const cues: DemuxedCue[] = [];

    // 逐个读样本。字幕样本都很小，一次读一批更快
    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i];
      const size = table.sizes[i];
      if (!size || off + size > file.size) continue;

      let text = '';
      if (codec === 'tx3g') {
        const raw = new Uint8Array(await file.slice(off, off + size).arrayBuffer());
        text = parseTx3g(raw);
      } else if (codec === 'wvtt' || codec === 'text') {
        const raw = new Uint8Array(await file.slice(off, off + size).arrayBuffer());
        text = TE.decode(raw).replace(/\u0000/g, '').trim();
      }

      if (!text) continue;

      const start = table.dts[i] ?? 0;
      // 结束时间 = 下一条的开始（字幕轨是离散的）
      const next = table.dts[i + 1];
      const end = next && next > start ? next : start + 2;

      cues.push({ start, end, text });
      if (i % 40 === 0) onProgress?.(20 + Math.round((i / offsets.length) * 70));
    }

    if (cues.length > 0) {
      tracks.push({
        index: subIndex++,
        streamIndex: streamCounter,
        codec,
        lang,
        cues,
      });
    }
  }

  onProgress?.(100);
  return tracks;
}
