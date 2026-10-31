/**
 * 验证示例素材：加载 → 抽字幕 → 读条数和内容 → 截图。
 * 用法：node scripts/diag-sample.mjs <输出图片路径>
 */
import { spawn } from 'node:child_process';
import { BROWSER } from './browser.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 9337;
const URL = 'http://127.0.0.1:4310/learn';
const SHOT = process.argv[2];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
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

const COUNT = `(() => {
  const list = document.querySelector('[data-page="learn"] aside .overflow-y-auto');
  if (!list) return 0;
  return list.querySelectorAll('p').length;
})()`;

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'edge-sample-'));
  const child = spawn(
    BROWSER,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1600,950',
      URL,
    ],
    { stdio: 'ignore' }
  );

  let code = 0;
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
    await c.send('Page.enable');
    await sleep(2200);

    console.log('点「示例视频」…');
    await c.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('示例视频'));
      if (b) b.click();
      return !!b;
    })()`);

    // 等字幕真正加载：data-sub-hash 非空就说明 applySrt 跑过了
    let hash = '';
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      hash = await c.eval(
        `document.querySelector('[data-page="learn"]')?.getAttribute('data-sub-hash') || ''`
      );
      if (hash) {
        console.log(`  ${i + 1} 秒后字幕就位，指纹 ${hash}`);
        break;
      }
      if (i % 10 === 9) console.log(`  抽取中… ${i + 1}s`);
    }

    const count = hash ? await c.eval(COUNT) : 0;
    if (count === 0) {
      console.log('★ 字幕没出来');
      code = 1;
    } else {
      const info = await c.eval(`(() => {
        const list = document.querySelector('[data-page="learn"] aside .overflow-y-auto');
        const rows = [...list.querySelectorAll('p')].map(p => (p.textContent||'').trim()).filter(Boolean);
        const zh = rows.filter(t => /[\\u4e00-\\u9fa5]/.test(t));
        const sound = rows.filter(t => /^[[(]/.test(t));
        return {
          total: rows.length,
          withChinese: zh.length,
          soundOnly: sound.length,
          first8: rows.slice(0, 8),
          badge: (document.querySelector('[data-page="learn"] .chip')?.textContent || '').trim(),
        };
      })()`);
      console.log('\n=== 字幕概况 ===');
      console.log(`  总条数: ${info.total}`);
      console.log(`  带中文: ${info.withChinese}`);
      console.log(`  纯音效: ${info.soundOnly}`);
      console.log(`  分类标签: ${info.badge}`);
      console.log('\n  前 8 条:');
      info.first8.forEach((t, i) => console.log(`    ${i + 1}. ${t.slice(0, 60)}`));

      // 跳到第 3 句，让画面停在有台词的一刻
      await c.eval(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('第 3 句'));
        if (b) b.click();
        return !!b;
      })()`);
      await sleep(1800);

      if (SHOT) {
        const shot = await c.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(SHOT, Buffer.from(shot.data, 'base64'));
        console.log(`\n截图: ${SHOT}`);
      }
    }

    ws.close();
  } catch (e) {
    console.error('出错：', e.message);
    code = 1;
  } finally {
    child.kill();
    await sleep(700);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  process.exit(code);
}

main();
