import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadSavedWords, persistSavedWords } from '../lib/saved-words';
import { fetchTextWithTimeout, watchMediaQuery } from '../lib/browser';
import { saveConfig, DEFAULT_CONFIG } from '../lib/translate';

async function main() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() {
      throw new DOMException('Storage is disabled', 'SecurityError');
    } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
    assert.deepEqual(loadSavedWords(), []);
    assert.equal(persistSavedWords([]), false);
    assert.equal(saveConfig(DEFAULT_CONFIG), false);

    let stored = 'not json';
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => { stored = value; },
    } });
    assert.deepEqual(loadSavedWords(), []);
    stored = '{}';
    assert.deepEqual(loadSavedWords(), []);
    const valid = { word: 'stopper', sentence: 'You need a new stopper.', translation: '止水塞', addedAt: 1 };
    stored = JSON.stringify([null, {}, valid]);
    assert.deepEqual(loadSavedWords(), [valid]);
    assert.equal(persistSavedWords([valid]), true);
    assert.deepEqual(loadSavedWords(), [valid]);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => stored,
      setItem() { throw new DOMException('Full', 'QuotaExceededError'); },
    } });
    assert.equal(persistSavedWords([valid]), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }

  for (const legacy of [false, true]) {
    let handler: (() => void) | undefined;
    let calls = 0;
    const query = legacy ? {
      addListener: (listener: () => void) => { handler = listener; },
      removeListener: () => { handler = undefined; },
    } : {
      addEventListener: (event: string, listener: () => void) => { assert.equal(event, 'change'); handler = listener; },
      removeEventListener: () => { handler = undefined; },
    };
    const stop = watchMediaQuery(query as unknown as MediaQueryList, () => { calls++; });
    handler?.();
    assert.equal(calls, 1);
    stop();
    assert.equal(handler, undefined);
  }

  const server = createServer((request, response) => {
    if (request.url === '/stall') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('partial subtitle'); // Headers arrive but the body never completes.
    } else if (request.url === '/missing') {
      response.writeHead(404).end();
    } else response.end('paired subtitles');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal(await fetchTextWithTimeout(`${base}/ok`), 'paired subtitles');
    await assert.rejects(fetchTextWithTimeout(`${base}/missing`), /加载失败/);
    await assert.rejects(fetchTextWithTimeout(`${base}/stall`, undefined, 100), /加载超时/);
    const cancel = new AbortController();
    const pending = fetchTextWithTimeout(`${base}/stall`, cancel.signal);
    cancel.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  console.log('PASS: disabled/full/malformed storage, modern/legacy Safari listeners, failed/stalled/cancelled requests.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
