import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { configureNetworkProxy, createServer, loopbackNoProxy } from '../server.mjs';

test('opens the downloads folder with an argument-safe Windows shell invocation', async () => {
  const source = await fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(source, /spawn\('powershell\.exe', \[/);
  assert.match(source, /'-NoProfile',\n\s*'-NonInteractive',\n\s*'-Command'/);
  assert.match(source, /\$ErrorActionPreference[^,\n]*Start-Process -FilePath \$env:VIDEO_DOWNLOADER_PATH/);
  assert.match(source, /env: \{ \.\.\.process\.env, VIDEO_DOWNLOADER_PATH: downloadsDir \}/);
  assert.match(source, /child\.once\('close', \(code\) =>/);
  assert.match(source, /code === 0 \? resolve\(\) : reject/);
});

async function withServer(overrides, fn) {
  const downloadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-downloader-test-'));
  const calls = { created: [], opened: 0, cleared: 0 };
  const pausedTask = { id: 'task-1', status: 'paused', progress: 50, filename: 'clip.mp4', fileAvailable: false };
  const downloadManager = {
    create(input) {
      calls.created.push(input);
      return { id: 'task-1', status: 'queued', progress: 0, filename: 'clip.mp4' };
    },
    get(id) {
      return id === 'task-1'
        ? { id, status: 'completed', progress: 100, filename: 'clip.mp4', fileAvailable: true }
        : null;
    },
    list() {
      return [{
        id: 'task-1',
        status: 'completed',
        progress: 100,
        filename: 'clip.mp4',
        fileAvailable: true,
      }];
    },
    clearHistory() {
      calls.cleared += 1;
    },
    removeHistory(id) {
      return id === 'task-1';
    },
    pause(id) {
      if (id !== 'task-1') return null;
      return pausedTask;
    },
    resume(id) {
      if (id !== 'task-1') return null;
      return { ...pausedTask, status: 'queued' };
    },
  };
  const server = createServer({
    downloadsDir,
    publicDir: path.resolve('video-downloader/public'),
    resolver: async () => ({
      title: 'Page title',
      thumbnail: null,
      items: [{
        id: 'video-1',
        title: 'Clip',
        duration: 10,
        format: 'HLS',
        resolution: 'Auto',
        thumbnail: null,
        sourceUrl: 'https://example.com/post',
        directUrl: 'https://cdn.example.com/clip.m3u8?token=secret',
        resolver: 'html',
      }],
    }),
    downloadManager,
    dependencies: { ytDlp: true, ffmpeg: true },
    openDownloads: async () => { calls.opened += 1; },
    ...overrides,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn({ baseUrl: `http://127.0.0.1:${port}`, downloadsDir, calls });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(downloadsDir, { recursive: true, force: true });
  }
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test('rejects hostile Host and Origin headers before invoking local actions', async () => {
  await withServer({}, async ({ baseUrl, calls }) => {
    const hostStatus = await new Promise((resolve, reject) => {
      const request = http.request(`${baseUrl}/api/open-downloads`, {
        method: 'POST', headers: { host: 'attacker.example' },
      }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
      request.end();
    });
    assert.equal(hostStatus, 403);
    const origin = await fetch(`${baseUrl}/api/open-downloads`, {
      method: 'POST', headers: { origin: 'https://attacker.example' },
    });
    assert.equal(origin.status, 403);
    assert.equal(calls.opened, 0);
  });
});

test('tolerates Node versions without the optional environment proxy API', () => {
  assert.equal(configureNetworkProxy({}, {}), undefined);
});

test('enables Node environment proxy support during startup', () => {
  let calls = 0;
  const restore = () => {};
  const env = {};
  const result = configureNetworkProxy({
    setGlobalProxyFromEnv() {
      calls += 1;
      return restore;
    },
  }, env);
  assert.equal(calls, 1);
  assert.equal(result, restore);
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1,::1');
});

test('adds loopback hosts to an existing no-proxy list without duplicates', () => {
  assert.equal(loopbackNoProxy('example.com,localhost,127.0.0.1'), 'example.com,localhost,127.0.0.1,::1');
});

test('reports health and dependency availability', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await json(await fetch(`${baseUrl}/api/health`));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, dependencies: { ytDlp: true, ffmpeg: true }, features: ['srt-separation'] });
  });
});

test('rejects malformed, missing, and unsupported resolve URLs', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const malformed = await json(await fetch(`${baseUrl}/api/resolve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    }));
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'INVALID_JSON');

    const missing = await json(await fetch(`${baseUrl}/api/resolve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    assert.equal(missing.status, 400);

    const protocol = await json(await fetch(`${baseUrl}/api/resolve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":"file:///secret"}',
    }));
    assert.equal(protocol.status, 400);
  });
});

test('resolves media without exposing the signed direct URL', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await json(await fetch(`${baseUrl}/api/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/post' }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.body.sourceUrl, 'https://example.com/post');
    assert.equal(response.body.items[0].id, 'video-1');
    assert.equal('directUrl' in response.body.items[0], false);
    assert.doesNotMatch(JSON.stringify(response.body), /secret/);
  });
});

test('resolves media through the interactive browser endpoint', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const response = await json(await fetch(`${baseUrl}/api/browser-resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/protected' }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.body.items[0].id, 'video-1');
  });
});

test('reports a clear browser verification timeout and logs safe diagnostics', async () => {
  const warnings = [];
  const error = new Error('internal browser text');
  error.code = 'BROWSER_VERIFICATION_TIMEOUT';
  error.diagnostic = {
    url: 'https://example.com/protected',
    title: 'Just a moment...',
    iframeCount: 1,
  };

  await withServer({
    interactiveResolver: async () => { throw error; },
    logger: { warn: (...args) => warnings.push(args) },
  }, async ({ baseUrl }) => {
    const response = await json(await fetch(`${baseUrl}/api/browser-resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/protected' }),
    }));
    assert.equal(response.status, 422);
    assert.deepEqual(response.body.error, {
      code: 'BROWSER_VERIFICATION_TIMEOUT',
      message: '浏览器验证未完成或已超时，请重试。',
    });
    assert.deepEqual(warnings, [[
      'Browser resolve failed.',
      {
        code: 'BROWSER_VERIFICATION_TIMEOUT',
        sourceUrl: 'https://example.com/protected',
        finalUrl: 'https://example.com/protected',
        title: 'Just a moment...',
        iframeCount: 1,
      },
    ]]);
  });
});

test('creates downloads only from cached resolver items', async () => {
  await withServer({}, async ({ baseUrl, calls }) => {
    await fetch(`${baseUrl}/api/resolve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/post' }),
    });
    const created = await json(await fetch(`${baseUrl}/api/downloads`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceUrl: 'https://example.com/post', itemId: 'video-1', title: 'My clip' }),
    }));
    assert.equal(created.status, 202);
    assert.equal(calls.created[0].item.directUrl.includes('secret'), true);

    const uncached = await json(await fetch(`${baseUrl}/api/downloads`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceUrl: 'https://other.example/post', itemId: 'video-1' }),
    }));
    assert.equal(uncached.status, 409);
  });
});

test('returns task state and a 404 for unknown tasks', async () => {
  await withServer({}, async ({ baseUrl }) => {
    assert.equal((await fetch(`${baseUrl}/api/downloads/task-1`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/downloads/missing`)).status, 404);
  });
});

test('lists and clears download history', async () => {
  await withServer({}, async ({ baseUrl, calls }) => {
    const listed = await json(await fetch(`${baseUrl}/api/downloads`));
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items[0].fileUrl, '/api/files/clip.mp4');

    const cleared = await fetch(`${baseUrl}/api/downloads`, { method: 'DELETE' });
    assert.equal(cleared.status, 204);
    assert.equal(calls.cleared, 1);
  });
});

test('deletes one terminal history record without using the file endpoint', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const deleted = await fetch(`${baseUrl}/api/downloads/task-1`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    assert.equal((await fetch(`${baseUrl}/api/downloads/missing`, { method: 'DELETE' })).status, 404);
  });
});

test('opens the downloads directory through the injected local action', async () => {
  await withServer({}, async ({ baseUrl, calls }) => {
    const response = await fetch(`${baseUrl}/api/open-downloads`, { method: 'POST' });
    assert.equal(response.status, 204);
    assert.equal(calls.opened, 1);
  });
});

test('pauses and resumes downloads through local task actions', async () => {
  await withServer({}, async ({ baseUrl }) => {
    const paused = await json(await fetch(`${baseUrl}/api/downloads/task-1/pause`, { method: 'POST' }));
    assert.equal(paused.status, 200);
    assert.equal(paused.body.status, 'paused');

    const resumed = await json(await fetch(`${baseUrl}/api/downloads/task-1/resume`, { method: 'POST' }));
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.status, 'queued');

    assert.equal((await fetch(`${baseUrl}/api/downloads/missing/pause`, { method: 'POST' })).status, 404);
  });
});

test('serves completed files and blocks traversal', async () => {
  await withServer({}, async ({ baseUrl, downloadsDir }) => {
    await fs.writeFile(path.join(downloadsDir, 'clip.mp4'), 'video-bytes');
    const file = await fetch(`${baseUrl}/api/files/clip.mp4`);
    assert.equal(file.status, 200);
    assert.equal(await file.text(), 'video-bytes');
    assert.match(file.headers.get('content-disposition'), /attachment/i);

    const traversal = await fetch(`${baseUrl}/api/files/${encodeURIComponent('../secret.txt')}`);
    assert.ok([400, 404].includes(traversal.status));
  });
});

test('serves SRT separately and exposes subtitle links in completed history', async () => {
  const task = { id: 'sub-task', status: 'completed', filename: 'clip.mp4', fileAvailable: true,
    subtitleStatus: 'available', subtitles: [{ filename: 'clip.eng.2.srt', language: 'eng', fileAvailable: true }] };
  await withServer({ downloadManager: { list: () => [task] } }, async ({ baseUrl, downloadsDir }) => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nHello.\n';
    await fs.writeFile(path.join(downloadsDir, 'clip.eng.2.srt'), srt);
    const history = await (await fetch(`${baseUrl}/api/downloads`)).json();
    assert.equal(history.items[0].subtitles[0].fileUrl, '/api/files/clip.eng.2.srt');
    const response = await fetch(baseUrl + history.items[0].subtitles[0].fileUrl);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /subrip.*utf-8/);
    assert.match(response.headers.get('content-disposition'), /attachment/);
    assert.equal(await response.text(), srt);
    await fs.writeFile(path.join(downloadsDir, 'private.json'), '{}');
    assert.equal((await fetch(`${baseUrl}/api/files/private.json`)).status, 404);
  });
});
