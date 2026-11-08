import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  isPrivateIp,
  normalizePublicUrl,
  resolveDownloadPath,
  sanitizeFilename,
} from '../lib/security.mjs';

const lookup = async (hostname) => {
  const addresses = {
    'example.com': [{ address: '93.184.216.34', family: 4 }],
    'fake-ip.example': [{ address: '198.18.0.30', family: 4 }],
    'private.example': [{ address: '10.12.0.8', family: 4 }],
    'mixed.example': [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ],
  };
  return addresses[hostname] ?? [];
};

test('normalizes a public HTTPS URL', async () => {
  const url = await normalizePublicUrl('  https://example.com/video?id=1  ', { lookup });
  assert.equal(url.href, 'https://example.com/video?id=1');
});

test('allows a hostname with Fake-IP DNS behind a loopback proxy', async () => {
  const url = await normalizePublicUrl('https://fake-ip.example/video', {
    lookup,
    env: { HTTPS_PROXY: 'http://127.0.0.1:7897' },
  });
  assert.equal(url.href, 'https://fake-ip.example/video');
});

test('rejects Fake-IP DNS without a loopback proxy', async () => {
  await assert.rejects(
    () => normalizePublicUrl('https://fake-ip.example/video', { lookup, env: {} }),
    /private or local/i,
  );
});

test('rejects literal Fake-IP and ordinary private DNS with a loopback proxy', async () => {
  const env = { HTTPS_PROXY: 'http://127.0.0.1:7897' };
  await assert.rejects(
    () => normalizePublicUrl('https://198.18.0.30/video', { lookup, env }),
    /private or local/i,
  );
  await assert.rejects(
    () => normalizePublicUrl('https://private.example/video', { lookup, env }),
    /private or local/i,
  );
});

test('rejects unsupported protocols and credentials', async () => {
  await assert.rejects(() => normalizePublicUrl('file:///C:/secret', { lookup }), /http or https/i);
  await assert.rejects(() => normalizePublicUrl('https://user:pass@example.com', { lookup }), /credentials/i);
});

test('rejects localhost and private DNS results', async () => {
  await assert.rejects(() => normalizePublicUrl('http://localhost/video', { lookup }), /private or local/i);
  await assert.rejects(() => normalizePublicUrl('http://private.example/video', { lookup }), /private or local/i);
  await assert.rejects(() => normalizePublicUrl('http://mixed.example/video', { lookup }), /private or local/i);
});

test('classifies private, reserved, and documentation IP ranges', () => {
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '::', '::1',
    'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:127.0.0.1',
  ]) {
    assert.equal(isPrivateIp(address), true, address);
  }
  assert.equal(isPrivateIp('93.184.216.34'), false);
  assert.equal(isPrivateIp('2606:2800:220:1:248:1893:25c8:1946'), false);
});

test('sanitizes unsafe Windows filenames', () => {
  assert.equal(sanitizeFilename('  Demo: clip?  '), 'Demo clip');
  assert.equal(sanitizeFilename('CON'), '_CON');
  assert.equal(sanitizeFilename('..'), 'video');
  assert.equal(sanitizeFilename('a/b\\c*|"<>'), 'a b c');
  assert.equal(sanitizeFilename('x'.repeat(300)).length, 120);
});

test('keeps resolved files inside the downloads directory', () => {
  const root = path.resolve('C:\\app\\downloads');
  assert.equal(resolveDownloadPath(root, 'clip.mp4'), path.join(root, 'clip.mp4'));
  assert.throws(() => resolveDownloadPath(root, '..\\secret.txt'), /outside/i);
  assert.throws(() => resolveDownloadPath(root, 'nested/clip.mp4'), /outside/i);
});
test('blocks canonical and expanded IPv4-mapped private IPv6 addresses', () => {
  for (const address of ['::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:c0a8:1', '::ffff:169.254.169.254', '::ffff:198.18.0.1']) {
    assert.equal(isPrivateIp(address), true, address);
  }
  assert.equal(isPrivateIp('::ffff:0808:0808'), false);
});
