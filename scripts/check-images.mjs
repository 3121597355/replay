/**
 * 检查页面里所有 img 的真实加载状态。
 * 用法：node scripts/check-images.mjs [url]
 */
import { spawn } from 'node:child_process';
import { BROWSER } from './browser.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 9341;
const url = process.argv[2] ?? 'http://127.0.0.1:4310/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('CDP 没起来');
}

async function pickTarget() {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await r.json();
    const p = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
    if (p?.webSocketDebuggerUrl) return p;
    await sleep(300);
  }
  throw new Error('没找到页面');
}

function client(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  });
  return {
    send(method, params = {}) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => {
          if (pending.has(mid)) {
            pending.delete(mid);
            reject(new Error(method + ' 超时'));
          }
        }, 30000);
      });
    },
    async eval(expr) {
      const r = await this.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval 失败');
      return r.result.value;
    },
  };
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'edge-img-'));
  const child = spawn(
    BROWSER,
    ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
     '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1500,900', url],
    { stdio: 'ignore' }
  );

  try {
    await waitPort();
    const t = await pickTarget();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = client(ws);
    await c.send('Runtime.enable');
    await sleep(5000);

    // 滚到底再回顶，触发所有 lazy
    await c.eval(`(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 2000));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 2000));
      return 'ok';
    })()`);
    await sleep(2000);

    const imgs = await c.eval(`(() => {
      return [...document.querySelectorAll('img')].map(i => ({
        src: (i.currentSrc || i.src || '').split('/').pop().slice(0, 34),
        complete: i.complete,
        w: i.naturalWidth,
        h: i.naturalHeight,
        loading: i.loading,
        visible: i.getBoundingClientRect().height > 0,
      }));
    })()`);

    console.log(`共 ${imgs.length} 张 img\n`);
    const bad = [];
    imgs.forEach((i) => {
      const ok = i.complete && i.w > 0;
      if (!ok) bad.push(i);
      console.log(
        `  ${ok ? '✓' : '✗'} ${i.src.padEnd(34)} ${String(i.w).padStart(4)}x${String(i.h).padEnd(5)} ${i.loading}`
      );
    });

    console.log(`\n失败 ${bad.length} 张`);
    if (bad.length) {
      console.log('失败清单：');
      bad.forEach((b) => console.log(`  - ${b.src} complete=${b.complete} w=${b.w}`));
    }
    ws.close();
  } catch (e) {
    console.error('出错:', e.message);
  } finally {
    child.kill();
    await sleep(600);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  process.exit(0);
}

main();
