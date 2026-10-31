/**
 * 测抽取耗时构成 + 进度条是否真的在动。
 * 用法：node scripts/diag-extract-speed.mjs
 */
import { spawn } from 'node:child_process';
import { BROWSER } from './browser.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 9338;
const URL = 'http://127.0.0.1:4310/learn';

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
  throw new Error('CDP 端口没起来');
}

async function pickTarget() {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await r.json();
    const page = list.find((t) => t.type === 'page' && t.url.includes('127.0.0.1:4310'));
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
        }, 30000);
      });
    },
    async eval(expression) {
      const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval 失败');
      return r.result.value;
    },
  };
}

/** 读进度条的宽度百分比 + 文案 */
const PROBE = `(() => {
  const bar = document.querySelector('[data-page="learn"] .bg-gradient-to-r.from-gold-500');
  const label = bar ? bar.closest('div.flex')?.querySelector('span') : null;
  const pctEl = bar ? bar.closest('div.flex')?.querySelector('.tnum') : null;
  const track = bar?.parentElement;
  const width = bar && track ? Math.round(bar.getBoundingClientRect().width / track.getBoundingClientRect().width * 100) : null;
  return {
    text: label ? (label.textContent || '').trim() : null,
    pct: pctEl ? (pctEl.textContent || '').trim() : null,
    width,
    hash: document.querySelector('[data-page="learn"]')?.getAttribute('data-sub-hash') || '',
  };
})()`;

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'edge-speed-'));
  const child = spawn(
    BROWSER,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1400,900',
      URL,
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
    await c.send('Runtime.enable');
    await sleep(2200);

    const t0 = Date.now();
    await c.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('示例视频'));
      if (b) b.click();
      return !!b;
    })()`);

    console.log('时间(s)  进度条  文案');
    console.log('-------  ------  ------------------------------------------');
    let last = '';
    let doneAt = null;

    for (let i = 0; i < 90; i++) {
      await sleep(500);
      const p = await c.eval(PROBE);
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      const line = `${String(p.width ?? '-').padStart(6)}%  ${p.text ?? '(无进度条)'}`;
      // 只在变化时打印，避免刷屏
      if (line !== last) {
        console.log(`${sec.padStart(7)}  ${line}`);
        last = line;
      }
      if (p.hash) {
        doneAt = sec;
        break;
      }
    }

    console.log('\n=== 结论 ===');
    if (doneAt) {
      console.log(`  从点击到字幕就位：${doneAt} 秒`);
    } else {
      console.log('  ★ 120 秒内没完成');
    }

    const final = await c.eval(PROBE);
    console.log(`  最终进度条停在：${final.width}%`);

    ws.close();
  } catch (e) {
    console.error('出错：', e.message);
  } finally {
    child.kill();
    await sleep(700);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  process.exit(0);
}

main();
