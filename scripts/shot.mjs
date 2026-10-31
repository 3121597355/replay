/**
 * 通用整页截图。用法: node scripts/shot.mjs <url> <out.png> [宽] [高]
 * 整页截（captureBeyondViewport），不是只截视口。
 */
import { spawn } from 'node:child_process';
import { BROWSER } from './browser.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 9339;
const [, , url = 'http://127.0.0.1:4310/', out = 'shot.png', w = '1600', h = '1000', scrollTo = '', theme = ''] = process.argv;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch {
      /* not up */
    }
    await sleep(300);
  }
  throw new Error('CDP 没起来');
}

async function pickTarget() {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await r.json();
    const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
    if (page?.webSocketDebuggerUrl) return page;
    await sleep(300);
  }
  throw new Error('没找到页面');
}

function client(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
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
            reject(new Error(`${method} 超时`));
          }
        }, 40000);
      });
    },
  };
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'edge-shot-'));
  const child = spawn(
    BROWSER,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      `--window-size=${w},${h}`,
      url,
    ],
    { stdio: 'ignore' }
  );

  try {
    await waitPort();
    const target = await pickTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = client(ws);
    await c.send('Page.enable');
    // 等字体
    await sleep(3000);

    // 可选：滚动前先指定主题
    if (theme === 'dark' || theme === 'light') {
      await c.send('Runtime.evaluate', {
        expression: `document.documentElement.dataset.theme = ${JSON.stringify(theme)};`,
        returnByValue: true,
      });
      await sleep(500);
    }

    // 可选：滚到某个锚点，触发懒加载后再截
    if (scrollTo) {
      await c.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(scrollTo)});
          if (!el) return 'not-found';
          el.scrollIntoView({ behavior: 'instant', block: 'start' });
          return 'ok';
        })()`,
        returnByValue: true,
      });
      await sleep(2800);
    } else {
      // 整页截图：先滚到底把所有 lazy 图都拉起来，再回顶部
      await c.send('Runtime.evaluate', {
        expression: `(async () => {
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(r => setTimeout(r, 1200));
          window.scrollTo(0, 0);
          await new Promise(r => setTimeout(r, 1200));
          return 'done';
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      await sleep(2200);
    }

    const shot = await c.send('Page.captureScreenshot', {
      format: 'png',
      // 滚过之后只截视口，整页截会把没加载的部分也拍进来
      captureBeyondViewport: !scrollTo,
      optimizeForSpeed: false,
    });
    await writeFile(out, Buffer.from(shot.data, 'base64'));
    console.log(`截图: ${out}`);
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
