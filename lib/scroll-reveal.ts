import { watchMediaQuery } from './browser';

/** A single pair of observers handles the home page, including filtered cards. */
export function setupScrollReveal(root: HTMLElement, mode: 'system' | 'soft' | 'reduce' = 'system') {
  if (typeof IntersectionObserver === 'undefined' || typeof Element.prototype.animate !== 'function') {
    return () => {};
  }

  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => mode === 'reduce' || (mode === 'system' && media.matches);
  const pendingClass = 'home-reveal-pending';
  const targets = new Map<HTMLElement, { ready: boolean; delay: number; animation?: Animation }>();
  const cancel = (element: HTMLElement) => {
    const state = targets.get(element);
    state?.animation?.cancel();
    if (state) state.animation = undefined;
    element.classList.remove(pendingClass);
  };
  const prepare = (element: HTMLElement) => {
    const state = targets.get(element);
    if (!state || reduced() || element.contains(document.activeElement)) return;
    cancel(element);
    state.ready = true;
    element.classList.add(pendingClass);
  };
  const enter = new IntersectionObserver((entries) => {
    if (document.hidden) return;
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      const state = targets.get(element);
      if (!entry.isIntersecting || !state?.ready) continue;
      state.ready = false;
      cancel(element);
      if (reduced() || element.contains(document.activeElement)) continue;
      const animation = element.animate([
        { opacity: 0, transform: 'translateY(32px)' },
        { opacity: 1, transform: 'none' },
      ], { duration: 850, delay: state.delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
      state.animation = animation;
      const finish = () => { if (state.animation === animation) state.animation = undefined; };
      animation.onfinish = finish;
      animation.oncancel = finish;
    }
  }, { threshold: 0, rootMargin: '0px 0px -80px 0px' });
  // Rearm only when completely outside the wider boundary, avoiding flicker
  // from small scroll reversals near the bottom of the screen.
  const leave = new IntersectionObserver((entries) => {
    if (document.hidden) return;
    for (const entry of entries) {
      if (!entry.isIntersecting) prepare(entry.target as HTMLElement);
    }
  }, { threshold: 0, rootMargin: '100px 0px 100px 0px' });

  const register = () => {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))) {
      if (targets.has(element)) continue;
      const delay = Number(element.dataset.revealDelay) || 0;
      targets.set(element, { ready: true, delay: Math.max(0, Math.min(delay, 360)) });
      // SSR and the first screen stay readable; only arm below-fold content.
      if (element.getBoundingClientRect().top >= window.innerHeight - 80) prepare(element);
      enter.observe(element);
      leave.observe(element);
    }
    for (const element of Array.from(targets.keys())) {
      if (root.contains(element)) continue;
      cancel(element);
      enter.unobserve(element);
      leave.unobserve(element);
      targets.delete(element);
    }
  };
  register();
  const changes = new MutationObserver(register);
  changes.observe(root, { childList: true, subtree: true });

  const showFocused = (event: FocusEvent) => {
    // Cancelling a moving card between pointerdown and pointerup can move the
    // link away from the pointer. Only keyboard focus needs an instant reveal.
    if (!(event.target instanceof HTMLElement) || !event.target.matches(':focus-visible')) return;
    for (const [element, state] of Array.from(targets)) {
      if (!(event.target instanceof Node) || !element.contains(event.target)) continue;
      state.ready = false;
      cancel(element);
    }
  };
  const refresh = () => {
    if (document.hidden) {
      for (const [element, state] of Array.from(targets)) {
        if (!state.animation) continue;
        cancel(element);
        state.ready = true;
      }
      return;
    }
    enter.disconnect();
    leave.disconnect();
    for (const element of Array.from(targets.keys())) {
      enter.observe(element);
      leave.observe(element);
    }
  };
  const changeMotion = () => {
    if (reduced()) {
      for (const [element, state] of Array.from(targets)) {
        state.ready = false;
        cancel(element);
      }
    } else {
      for (const element of Array.from(targets.keys())) {
        if (element.getBoundingClientRect().top >= window.innerHeight - 80) prepare(element);
      }
    }
    refresh();
  };
  root.addEventListener('focusin', showFocused);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pageshow', refresh);
  const stopWatchingMotion = watchMediaQuery(media, changeMotion);
  return () => {
    changes.disconnect();
    enter.disconnect();
    leave.disconnect();
    root.removeEventListener('focusin', showFocused);
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('pageshow', refresh);
    stopWatchingMotion();
    for (const element of Array.from(targets.keys())) cancel(element);
    targets.clear();
  };
}
