import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';

const IPV4_BLOCKS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const FAKE_IPV4_NETWORK = '198.18.0.0';
const FAKE_IPV4_PREFIX = 15;
const LOOPBACK_PROXY_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function ipv4Number(address) {
  return address.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function ipv4InCidr(address, network, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(network) & mask);
}

function isFakeIp(address) {
  return net.isIP(address) === 4
    && ipv4InCidr(address, FAKE_IPV4_NETWORK, FAKE_IPV4_PREFIX);
}

function hasLoopbackProxy(env) {
  for (const key of [
    'HTTPS_PROXY', 'https_proxy',
    'HTTP_PROXY', 'http_proxy',
    'ALL_PROXY', 'all_proxy',
  ]) {
    if (!env?.[key]) continue;
    try {
      const proxy = new URL(env[key]);
      const hostname = proxy.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      if (['http:', 'https:'].includes(proxy.protocol)
        && LOOPBACK_PROXY_HOSTS.has(hostname)) return true;
    } catch {
      // An invalid proxy value must not enable the Fake-IP exception.
    }
  }
  return false;
}

export function isPrivateIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    return IPV4_BLOCKS.some(([network, prefix]) => ipv4InCidr(address, network, prefix));
  }

  if (family !== 6) return true;

  // Canonicalize dotted and expanded IPv4-mapped IPv6 before checking ranges.
  let normalized;
  try { normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1); }
  catch { return true; }
  const mapped = normalized.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return isPrivateIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return !/^[23][\da-f]{3}:/.test(normalized)
    || normalized.startsWith('2001:db8:')
    || normalized.startsWith('2001::')
    || normalized.startsWith('2002:');
}

export async function normalizePublicUrl(input, {
  lookup = dns.lookup,
  env = process.env,
} = {}) {
  let url;
  try {
    url = new URL(String(input ?? '').trim());
  } catch {
    throw new Error('Enter a valid URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('URLs with credentials are not allowed.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Private or local addresses are not allowed.');
  }

  const literalFamily = net.isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true, verbatim: true });
  const allowFakeIp = !literalFamily && hasLoopbackProxy(env);

  if (!addresses.length || addresses.some(({ address }) => (
    isPrivateIp(address) && !(allowFakeIp && isFakeIp(address))
  ))) {
    throw new Error('Private or local addresses are not allowed.');
  }

  return url;
}

export function sanitizeFilename(input) {
  let name = String(input ?? '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  if (!name || name === '.' || name === '..') name = 'video';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name.slice(0, 120).trimEnd() || 'video';
}

export function resolveDownloadPath(root, name) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, String(name ?? ''));
  if (path.dirname(target) !== resolvedRoot) {
    throw new Error('Requested file is outside the downloads directory.');
  }
  return target;
}
