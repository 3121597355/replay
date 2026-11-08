/** Older Safari exposes addListener rather than addEventListener. */
export function watchMediaQuery(query: MediaQueryList, listener: () => void): () => void {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }
  query.addListener(listener);
  return () => query.removeListener(listener);
}

/** The timeout covers the response body as well as the initial connection. */
export async function fetchTextWithTimeout(url: string, signal?: AbortSignal, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('示例字幕加载失败，请重试');
    return await response.text();
  } catch (error) {
    if (timedOut) throw new Error('示例字幕加载超时，请检查网络后重试');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
