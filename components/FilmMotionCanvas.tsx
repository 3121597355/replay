'use client';

import { useEffect, useRef } from 'react';
import { createFilmPlayer, prepareFilmBuffer, type FilmPlayer } from '@/lib/film-canvas';

export default function FilmMotionCanvas({ slug, playing, loaded, onReady, onError }: {
  slug: string; playing: boolean; loaded: boolean; onReady: () => void; onError: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<FilmPlayer>();
  const callbacks = useRef({ onReady, onError, playing });
  useEffect(() => { callbacks.current = { onReady, onError, playing }; }, [onReady, onError, playing]);
  useEffect(() => { player.current?.setPlaying(playing); }, [playing]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { controller.abort(); callbacks.current.onError(); }, 20000);
    async function load() {
      try {
        const response = await fetch(`/home/${slug}.rpl`, { signal: controller.signal });
        if (!response.ok) throw new Error('Film request failed');
        const reader = response.body?.getReader();
        let prefix = new Uint8Array(0), buffer: ArrayBuffer | undefined, received = 0;
        async function start(bytes: ArrayBuffer) {
          if (controller.signal.aborted || !canvas.current) return;
          const instance = await createFilmPlayer(canvas.current, bytes, controller.signal,
            () => callbacks.current.onReady(), () => callbacks.current.onError(), () => received);
          if (controller.signal.aborted) { instance?.dispose(); return; }
          player.current = instance;
          instance?.setPlaying(callbacks.current.playing);
        }
        if (!reader) {
          const bytes = await response.arrayBuffer(); received = bytes.byteLength; await start(bytes);
        } else {
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!buffer) {
              const joined = new Uint8Array(prefix.length + value.length); joined.set(prefix); joined.set(value, prefix.length);
              prefix = joined; received = prefix.length; buffer = prepareFilmBuffer(prefix);
              if (buffer) { await start(buffer); prefix = new Uint8Array(0); }
            } else {
              if (received + value.length > buffer.byteLength) throw new Error('Unexpected film data');
              new Uint8Array(buffer).set(value, received); received += value.length; player.current?.refresh();
            }
          }
          if (!controller.signal.aborted && (!buffer || received !== buffer.byteLength)) throw new Error('Incomplete film data');
        }
      } catch { if (!controller.signal.aborted) callbacks.current.onError(); }
      finally { window.clearTimeout(timeout); }
    }
    void load();
    return () => { window.clearTimeout(timeout); controller.abort(); player.current?.dispose(); player.current = undefined; };
  }, [slug]);
  return <canvas ref={canvas} width={1280} height={720} className="home-film-motion" data-loaded={loaded} />;
}
