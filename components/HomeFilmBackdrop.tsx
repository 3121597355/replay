'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import { useHomeMotionEnabled } from '@/components/HomeMotion';
import films from '@/lib/home-films.json';

type Cycle = { index: number; phase: 'hold' | 'outgoing' | 'incoming'; ready: string[] };

export default function HomeFilmBackdrop() {
  const backdrop = useRef<HTMLDivElement>(null);
  const enabled = useHomeMotionEnabled();
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cycle, setCycle] = useState<Cycle>({ index: 0, phase: 'hold', ready: [] });
  const animate = enabled && inView && pageVisible && !saveData && !failed;
  const nextIndex = (cycle.index + 1) % films.clips.length;
  // Switch the caption at the dissolve midpoint, when the next film becomes dominant.
  const displayIndex = cycle.phase === 'incoming' ? nextIndex : cycle.index;
  const film = films.clips[displayIndex];

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === 'visible');
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    const connection = (navigator as Navigator & {
      connection?: EventTarget & { saveData?: boolean };
    }).connection;
    const updateConnection = () => setSaveData(Boolean(connection?.saveData));
    updateConnection();
    connection?.addEventListener('change', updateConnection);
    const target = backdrop.current;
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
      : null;
    if (target && observer) observer.observe(target);
    else setInView(true);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      connection?.removeEventListener('change', updateConnection);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!animate) {
      setCycle(previous => previous.phase === 'hold' && previous.ready.length === 0
        ? previous : { index: displayIndex, phase: 'hold', ready: [] });
      return;
    }
    if (!cycle.ready.includes(films.clips[cycle.index].slug)
      || !cycle.ready.includes(films.clips[nextIndex].slug)) return;
    const timer = window.setTimeout(() => {
      setCycle(previous => {
        if (previous.phase === 'hold') return { ...previous, phase: 'outgoing' };
        if (previous.phase === 'outgoing') return { ...previous, phase: 'incoming' };
        return { index: nextIndex, phase: 'hold', ready: [films.clips[nextIndex].slug] };
      });
    }, cycle.phase === 'hold' ? films.holdMs : films.transitionMs / 2);
    return () => window.clearTimeout(timer);
  }, [animate, cycle, displayIndex, nextIndex]);

  return (
    <div ref={backdrop} className="home-film-backdrop" aria-hidden="true"
      data-film={film.slug} data-phase={cycle.phase}
      style={{ '--film-transition': `${films.transitionMs}ms` } as CSSProperties}>
      <div className="home-film-media" style={{ backgroundImage: `url('/home/${film.slug}.jpg')` }}>
        {/* An image keeps decorative motion out of browsers' video takeover players. */}
        {animate && [cycle.index, nextIndex].map(index => {
          const clip = films.clips[index];
          return <div key={clip.slug} className="home-film-scene"
            data-role={index === cycle.index ? 'current' : 'next'}
            data-reveal={cycle.phase !== 'hold'} data-film={clip.slug}
            style={{ backgroundImage: `url('/home/${clip.slug}.jpg')` }}>
            <Image
              src={`/home/${clip.slug}.webp`}
              alt=""
              width={640}
              height={360}
              unoptimized
              loading="eager"
              decoding="async"
              draggable={false}
              className="home-film-motion"
              data-loaded={cycle.ready.includes(clip.slug)}
              onLoad={() => setCycle(previous => previous.ready.includes(clip.slug)
                ? previous : { ...previous, ready: [...previous.ready, clip.slug] })}
              onError={() => setFailed(true)}
            />
          </div>;
        })}
      </div>
      <div className="home-film-shade" />
      <div className="home-film-caption">
        <span className="home-film-caption-line" />
        <span>{film.title} · {film.originalTitle}</span>
      </div>
    </div>
  );
}
