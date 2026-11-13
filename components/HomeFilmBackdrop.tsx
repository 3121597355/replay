'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useHomeMotionEnabled } from '@/components/HomeMotion';

export default function HomeFilmBackdrop() {
  const backdrop = useRef<HTMLDivElement>(null);
  const enabled = useHomeMotionEnabled();
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const animate = enabled && inView && pageVisible && !saveData && !failed;

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
    if (!animate) setLoaded(false);
  }, [animate]);

  return (
    <div ref={backdrop} className="home-film-backdrop" aria-hidden="true">
      <div className="home-film-media">
        {/* An image keeps decorative motion out of browsers' video takeover players. */}
        {animate && <Image
          src="/home/film-loop.webp"
          alt=""
          width={640}
          height={360}
          unoptimized
          loading="eager"
          decoding="async"
          draggable={false}
          className="home-film-motion"
          data-loaded={loaded}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />}
      </div>
      <div className="home-film-shade" />
      <div className="home-film-caption">
        <span className="home-film-caption-line" />
        <span>经典电影 · 美剧片段</span>
      </div>
    </div>
  );
}
