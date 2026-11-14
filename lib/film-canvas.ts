type Film = { codec: string; width: number; height: number; fps: number; frames: [number, number, number][] };
export type FilmPlayer = { setPlaying: (playing: boolean) => void; refresh: () => void; dispose: () => void };

/** Allocate once metadata arrives so playback can start before the full clip downloads. */
export function prepareFilmBuffer(prefix: Uint8Array): ArrayBuffer | undefined {
  if (prefix.length < 12) return;
  if (new TextDecoder().decode(prefix.subarray(0, 8)) !== 'RPLYM001') throw new Error('Invalid film header');
  const length = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(8, true);
  if (length > 100000) throw new Error('Invalid film metadata');
  if (prefix.length < 12 + length) return;
  const film: Film = JSON.parse(new TextDecoder().decode(prefix.subarray(12, 12 + length)));
  if (!Array.isArray(film.frames) || !film.frames.length) throw new Error('Invalid film frames');
  const last = film.frames[film.frames.length - 1];
  const total = 12 + length + last[0] + last[1];
  if (!Number.isInteger(total) || total < prefix.length || total > 20000000) throw new Error('Invalid film size');
  const buffer = new ArrayBuffer(total);
  new Uint8Array(buffer).set(prefix);
  // Full validation before a decoder or playback loop is created.
  readFilm(buffer);
  return buffer;
}

function readFilm(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== 'RPLYM001') throw new Error('Invalid film header');
  const length = new DataView(buffer).getUint32(8, true);
  if (length > 100000 || length + 12 >= bytes.length) throw new Error('Invalid film metadata');
  const film: Film = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length)));
  const payload = bytes.subarray(12 + length);
  if (!/^avc1\.[a-f0-9]{6}$/i.test(film.codec) || film.width !== 1280 || film.height !== 720
    || film.fps !== 24 || !Array.isArray(film.frames) || film.frames.length < 2 || film.frames.length > 1440) throw new Error('Unsupported film');
  for (const [offset, size, key] of film.frames) {
    if (!Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 1 || offset + size > payload.length
      || (key !== 0 && key !== 1)) throw new Error('Invalid film frame');
  }
  if (film.frames[0][2] !== 1) throw new Error('Missing key frame');
  return { film, payload, payloadStart: 12 + length };
}

/** Bounded decode-ahead; all VideoFrames and decoder resources are closed on disposal. */
export async function createFilmPlayer(canvas: HTMLCanvasElement, buffer: ArrayBuffer, signal: AbortSignal,
  onReady: () => void, onError: () => void, received = () => buffer.byteLength): Promise<FilmPlayer | undefined> {
  const { film, payload, payloadStart } = readFilm(buffer);
  const config: VideoDecoderConfig = { codec: film.codec, codedWidth: film.width, codedHeight: film.height,
    hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true };
  const support = await VideoDecoder.isConfigSupported(config);
  if (signal.aborted) return;
  if (!support.supported) throw new Error('Film decoding unavailable');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas unavailable');
  canvas.width = film.width; canvas.height = film.height;
  const queue: VideoFrame[] = [];
  let disposed = false, playing = false, ready = false, cursor = 0, pending = 0, raf = 0, origin = 0, playhead = 0;
  const paint = (frame: VideoFrame) => {
    context.drawImage(frame, 0, 0);
    canvas.dataset.time = String(frame.timestamp / 1000000);
    frame.close();
  };
  const decoder = new VideoDecoder({
    output(frame) {
      pending--;
      if (disposed) { frame.close(); return; }
      if (!ready) {
        paint(frame); ready = true; onReady();
      } else queue.push(frame);
    },
    error() { dispose(); if (!signal.aborted) onError(); },
  });
  const fill = () => {
    // Inactive next scene decodes only its first frame, not the whole hidden clip.
    const limit = playing ? 6 : 1;
    while (!disposed && cursor < film.frames.length && pending + queue.length < limit && (playing || !ready)) {
      const [offset, size, key] = film.frames[cursor];
      if (offset + size + payloadStart > received()) break;
      const chunk = new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: Math.round(cursor * 1000000 / film.fps),
        duration: Math.round(1000000 / film.fps), data: payload.subarray(offset, offset + size) });
      cursor++; pending++; decoder.decode(chunk);
    }
  };
  const tick = (now: number) => {
    if (disposed || !playing) return;
    playhead = (now - origin) * 1000;
    let frame: VideoFrame | undefined;
    while (queue.length && queue[0].timestamp <= playhead) { frame?.close(); frame = queue.shift(); }
    if (frame) paint(frame);
    try { fill(); } catch { dispose(); onError(); return; }
    if (cursor < film.frames.length || pending > 0 || queue.length) raf = requestAnimationFrame(tick);
  };
  function dispose() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(raf);
    queue.splice(0).forEach(frame => frame.close());
    if (decoder.state !== 'closed') decoder.close();
    signal.removeEventListener('abort', dispose);
  }
  try {
    decoder.configure(config);
    signal.addEventListener('abort', dispose, { once: true });
    fill();
  } catch (error) { dispose(); throw error; }
  return {
    setPlaying(value) {
      if (disposed || playing === value) return;
      playing = value;
      if (value) { origin = performance.now() - playhead / 1000; raf = requestAnimationFrame(tick); }
      else cancelAnimationFrame(raf);
    },
    refresh() { if (!disposed) { try { fill(); } catch { dispose(); onError(); } } },
    dispose,
  };
}
