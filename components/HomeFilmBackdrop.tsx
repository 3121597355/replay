'use client';

import { useEffect, useRef, useState } from 'react';
import { useHomeMotionEnabled } from '@/components/HomeMotion';
import sources from '@/scripts/home-montage-sources.json';

// Each four-second preview overlaps the next by 0.55 seconds.
const sceneSeconds = 3.45;
const halfFadeSeconds = 0.275;

export default function HomeFilmBackdrop() {
  const video = useRef<HTMLVideoElement>(null);
  const enabled = useHomeMotionEnabled();
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);

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
    const target = video.current;
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
    const element = video.current;
    if (!element) return;
    if (!enabled || !inView || !pageVisible || saveData || failed) {
      element.pause();
      return;
    }
    // Keep the poster until motion is allowed; reuse the clip after scrolling back.
    if (!element.getAttribute('src')) element.src = '/home/film-loop.mp4';
    element.play().catch(() => { /* Autoplay restrictions leave the still image visible. */ });
    return () => element.pause();
  }, [enabled, inView, pageVisible, saveData, failed]);

  return (
    <div className="home-film-backdrop" aria-hidden="true">
      <div className="home-film-media">
        <video
          ref={video}
          className="home-film-video"
          data-playing={playing && !failed}
          poster="/home/film-poster.jpg"
          preload="none"
          muted
          loop
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
          onTimeUpdate={(event) => setSceneIndex(Math.floor((event.currentTarget.currentTime + halfFadeSeconds) / sceneSeconds) % sources.length)}
        />
      </div>
      <div className="home-film-shade" />
      <div className="home-film-caption">
        <span className="home-film-caption-line" />
        <span>{sources[failed ? 0 : sceneIndex].originalTitle} · {sources[failed ? 0 : sceneIndex].title}</span>
      </div>
    </div>
  );
}
