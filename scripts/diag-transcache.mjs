/**
 * 翻译缓存端到端验证。
 *
 * 流程：
 *   1. 加载示例字幕，从 DOM 读出这次算出的内容指纹
 *   2. 往 localStorage 塞一份假译文（每句标「【测试】N」）
 *   3. 重新加载同一份字幕 —— 应该命中缓存，一句都不用重翻
 *   4. 检查界面里是否出现了假译文
 *
 * 用法：node scripts/diag-transcache.mjs
 */
import { spawn } from 'node:child_process';
import { BROWSER } from './browser.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 9336;
const URL = 'http://127.0.0.1:4310/learn';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {
      /* 还没起 */
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
  throw new Error('没找到目标页面');
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
        }, 25000);
      });
    },
    async eval(expression) {
      const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval 失败');
      return r.result.value;
    },
  };
}

const LOAD_SAMPLE = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('示例视频'));
  if (!b) return 'no-button';
  b.click();
  return 'clicked';
})()`;

/** 读当前字幕区里的中文行 */
const READ_ZH = `(() => {
  const list = document.querySelector('[data-page="learn"] aside .overflow-y-auto');
  if (!list) return { n: 0, sample: [] };
  const rows = [...list.querySelectorAll('p')].map(p => (p.textContent||'').trim()).filter(Boolean);
  const zh = rows.filter(t => /[\\u4e00-\\u9fa5]/.test(t));
  return { n: zh.length, sample: zh.slice(0, 3) };
})()`;

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'edge-trans-'));
  const child = spawn(
    BROWSER,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1600,900',
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
    await sleep(2400);

    console.log('① 首次加载示例字幕…');
    await c.eval(LOAD_SAMPLE);
    await sleep(33000);

    const hash = await c.eval(`document.querySelector('[data-page="learn"]')?.getAttribute('data-sub-hash') || ''`);
    console.log(`   内容指纹 = ${hash || '★ 空（说明没算出来）'}`);
    if (!hash) throw new Error('拿不到指纹，data-sub-hash 没渲染');

    const before = await c.eval(READ_ZH);
    console.log(`   当前中文行：${before.n} 条`);

    console.log('\n② 注入假译文（模拟「上次翻译过」）…');
    const wrote = await c.eval(`(() => {
      const items = Array.from({ length: 30 }, (_, i) => [i + 1, '【测试】第' + (i + 1) + '句']);
      const entry = { v: 1, name: 'sample-movie.mkv', savedAt: Date.now(), model: 'test-model', items };
      try {
        localStorage.setItem('replay.trans.' + ${JSON.stringify('__HASH__')}, JSON.stringify(entry));
        return 'ok';
      } catch (e) { return 'fail: ' + e.message; }
    })()`.replace('__HASH__', hash));
    console.log(`   写入：${wrote}`);
    if (wrote !== 'ok') throw new Error('写 localStorage 失败');

    const stored = await c.eval(`Object.keys(localStorage).filter(k => k.startsWith('replay.trans.')).join(',')`);
    console.log(`   localStorage 里的缓存 key：${stored || '（空）'}`);

    console.log('\n③ 重新加载页面 + 同一份字幕…');
    // 注意：加载过视频后 EmptyVideo 不再渲染，「示例视频」按钮会消失，
    // 所以必须 reload 回到初始状态才能再走一遍抽字幕流程。
    await c.eval('location.reload()');
    await sleep(5000);

    const clicked2 = await c.eval(LOAD_SAMPLE);
    console.log(`   第二次点击：${clicked2}`);
    if (clicked2 !== 'clicked') throw new Error('第二次没能触发加载');
    await sleep(33000);

    const hash2 = await c.eval(`document.querySelector('[data-page="learn"]')?.getAttribute('data-sub-hash') || ''`);
    console.log(`   内容指纹 = ${hash2}  ${hash2 === hash ? '✓ 与首次一致' : '★ 变了，缓存必然对不上'}`);
    console.log(`   缓存 key 存在：${await c.eval(`!!localStorage.getItem('replay.trans.${hash}')`)}`);

    const after = await c.eval(READ_ZH);
    const hasTest = await c.eval(`(() => {
      const list = document.querySelector('[data-page="learn"] aside .overflow-y-auto');
      return list ? /【测试】/.test(list.textContent || '') : false;
    })()`);

    console.log(`   重新加载后中文行：${after.n} 条`);
    console.log(`   样例：${JSON.stringify(after.sample)}`);

    console.log('\n=== 结论 ===');
    if (hasTest) {
      console.log('  ✓ 命中缓存：界面里出现了注入的「【测试】」译文');
      console.log('  ✓ 同一份字幕再导入，不会重新调用接口');
    } else {
      console.log('  ★ 没命中：重新加载后没看到注入的译文');
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
