import { NextRequest, NextResponse } from 'next/server';
import { analyticsConfig } from './analytics-config';

export const ADMIN_COOKIE = 'replay_admin';
export const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export function collectorConfig() {
  // Only trusted server configuration selects the upstream; user input cannot redirect tokens.
  if (process.env.REPLAY_ADMIN_COLLECTOR_URL?.startsWith('http://127.0.0.1:') && process.env.NODE_ENV !== 'production') return { endpoint: process.env.REPLAY_ADMIN_COLLECTOR_URL, siteId: 'replay' };
  const config = analyticsConfig({ endpoint: process.env.NEXT_PUBLIC_YILAN_COLLECTOR_URL ?? 'https://yilan-collector.yilan-public-collector.workers.dev', siteId: process.env.NEXT_PUBLIC_YILAN_WEBSITE_ID });
  if (!config) throw new Error('统计服务未启用');
  return { endpoint: new URL(config.src).origin, siteId: config.siteId };
}
export function sameOrigin(request: NextRequest) {
  // Next dev may normalize 127.0.0.1 to localhost in nextUrl. Host is the
  // destination authority sent by the browser, which scripts cannot override.
  const host = request.headers.get('host') || request.nextUrl.host;
  if (!/^[a-z0-9.\[\]:-]+$/i.test(host)) return false;
  return request.headers.get('origin') === `${request.nextUrl.protocol}//${host}`;
}
export async function smallText(request: NextRequest) {
  if (!request.body) return '';
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2048) { await reader.cancel(); return null; } chunks.push(value); }
  const bytes = new Uint8Array(size); let pos = 0; for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
export async function upstream(action: string, token: string, method = 'GET', body?: string, search = '') {
  const config = collectorConfig();
  const response = await fetch(`${config.endpoint}/v1/websites/${config.siteId}/admin/${action}${search}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) });
  return response;
}
export async function copyResponse(response: Response) {
  return new NextResponse(await response.text(), { status: response.status, headers: { ...noStore, 'Content-Type': 'application/json; charset=utf-8' } });
}
