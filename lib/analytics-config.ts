// Yilan connects directly to its own collector; no third-party analytics settings are needed.
export function analyticsConfig(env: { endpoint?: string; siteId?: string }) {
  if (!env.endpoint?.trim()) return null;
  let endpoint: URL;
  try { endpoint = new URL(env.endpoint); }
  catch { throw new Error('NEXT_PUBLIC_YILAN_COLLECTOR_URL 必须是有效的一览采集地址'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || endpoint.port || /^(localhost|127\.|0\.|10\.|192\.168\.|\[)/.test(endpoint.hostname))
    throw new Error('一览采集地址必须是公网 HTTPS 域名，不含路径或密钥');
  const siteId = env.siteId ?? 'replay';
  if (!/^[\w-]{1,100}$/.test(siteId)) throw new Error('NEXT_PUBLIC_YILAN_WEBSITE_ID 格式无效');
  return { src: endpoint.origin + '/tracker.js', siteId };
}
