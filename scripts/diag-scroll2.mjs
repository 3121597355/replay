/**
 * 滚动跟随的精准复现。
 *
 * headless 里 mkv 播不了（Chromium 不支持 matroska 容器），
 * 所以给 video.currentTime 打桩，手动 timeupdate 推进时间，
 * 直接触发 React 的 onTimeUpdate → setCurrent → 自动滚动。
 *
 * 三个阶段：
 *   A. 不干预，推进时间   → 列表应该跟随，window.scrollY 应该恒为 0
 *   B. 派发 wheel 事件     → 应该停止跟随，出现「回到第 N 句」
 *   C. 点那个按钮          → 应该滚回当前句并恢复跟随
 *
 * 用法：node scripts/diag-scroll2.mjs
 */
import { spawn } from 'node:child_process';
import { BROWSER } from './browser.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 9334;
const URL = 'http://127.0.0.1:4310/learn';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {
      /* not up yet */
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

function makeClient(ws) {
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
      const r = await this.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? 'eval 失败');
      }
      return r.result.value;
    },
  };
}

/** 读当前状态 */
const STATE = `(() => {
  const aside = document.querySelector('[data-page="learn"] aside');
  const list = aside ? aside.querySelector('.overflow-y-auto') : null;
  const backBtn = [...document.querySelectorAll('button')]
    .find(b => (b.textContent || '').includes('回到第'));
  const active = list ? list.querySelector('.cue-active') : null;
  return {
    scrollY: Math.round(window.scrollY),
    listTop: list ? Math.round(list.scrollTop) : null,
    activeIdx: active ? (active.textContent || '').trim().slice(0, 2) : null,
    activeVisible: active && list ? (() => {
      const ar = active.getBoundingClientRect();
      const lr = list.getBoundingClientRect();
      return ar.top >= lr.top - 2 && ar.bottom <= lr.bottom + 2;
    })() : null,
    backBtn: backBtn ? (backBtn.textContent || '').trim() : null,
  };
})()`;

/** 打桩 currentTime + 暴露推进函数 */
const INSTALL = `(() => {
  const v = document.querySelector('video');
  if (!v) return 'no-video';
  if (window.__stubbed) return 'already';
  window.__t = v.currentTime || 0;
  Object.defineProperty(v, 'currentTime', {
    configurable: true,
    get() { return window.__t; },
    set(x) { window.__t = x; },
  });
  window.__tick = (t) => {
    window.__t = t;
    v.dispatchEvent(new Event('timeupdate', { bubbles: true }));
  };
  window.__stubbed = true;
  return 'ok';
})()`;

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'edge-diag2-'));
  const child = spawn(
    BROWSER,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1600,900',
      URL,
    ],
    { stdio: 'ignore' }
  );

  let code = 0;
  try {
    const ver = await waitPort();
    console.log(`环境：${ver.Browser}\n`);
    const target = await pickTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = makeClient(ws);
    await c.send('Runtime.enable');
    await sleep(2200);

    console.log('加载示例字幕（约 30 秒）…');
    await c.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('示例视频'));
      if (b) b.click();
      return b ? 'clicked' : 'not-found';
    })()`);
    await sleep(32000);

    const stubbed = await c.eval(INSTALL);
    console.log(`打桩：${stubbed}`);
    if (stubbed !== 'ok' && stubbed !== 'already') throw new Error('打桩失败');

    const cueCount = await c.eval(
      `document.querySelectorAll('[data-page="learn"] aside .overflow-y-auto .cue-hover, [data-page="learn"] aside .overflow-y-auto > div > div').length`
    );
    console.log(`字幕行数：约 ${cueCount}\n`);

    // ── 阶段 A：不干预，推进时间 ──
    console.log('=== 阶段 A：正常播放，推进时间 ===');
    console.log('   时间    scrollY  listTop  active   可见    回到按钮');
    for (let i = 0; i < 8; i++) {
      const t = 5 + i * 12;
      await c.eval(`window.__tick(${t})`);
      await sleep(700);
      const s = await c.eval(STATE);
      console.log(
        `  ${String(t).padStart(4)}s  ${String(s.scrollY).padStart(6)}  ${String(s.listTop).padStart(6)}  ${String(s.activeIdx ?? '-').padStart(5)}  ${String(s.activeVisible).padStart(6)}  ${s.backBtn ?? '-'}`
      );
    }

    // ── 阶段 B：模拟用户滚动 ──
    console.log('\n=== 阶段 B：派发 wheel（模拟用户滚动）===');
    await c.eval(`(() => {
      const list = document.querySelector('[data-page="learn"] aside .overflow-y-auto');
      list.scrollTop = 0;
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true }));
      return 'wheel-sent';
    })()`);
    await sleep(600);

    console.log('   时间    scrollY  listTop  active   可见    回到按钮');
    for (let i = 0; i < 5; i++) {
      const t = 110 + i * 12;
      await c.eval(`window.__tick(${t})`);
      await sleep(700);
      const s = await c.eval(STATE);
      console.log(
        `  ${String(t).padStart(4)}s  ${String(s.scrollY).padStart(6)}  ${String(s.listTop).padStart(6)}  ${String(s.activeIdx ?? '-').padStart(5)}  ${String(s.activeVisible).padStart(6)}  ${s.backBtn ?? '-'}`
      );
    }

    // ── 阶段 C：点「回到第 N 句」 ──
    console.log('\n=== 阶段 C：点「回到第 N 句」 ===');
    const beforeC = await c.eval(STATE);
    console.log(`  点击前：listTop=${beforeC.listTop} 按钮=${beforeC.backBtn ?? '无'}`);
    const clickedC = await c.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('回到第'));
      if (!b) return 'no-button';
      b.click();
      return 'clicked';
    })()`);
    await sleep(1200);
    const afterC = await c.eval(STATE);
    console.log(`  点了：${clickedC}`);
    console.log(`  点击后：listTop=${afterC.listTop} 按钮=${afterC.backBtn ?? '无'} 可见=${afterC.activeVisible}`);

    // ── 汇总 ──
    console.log('\n=== 结论 ===');
    const a = await c.eval(STATE);
    console.log(`  最终 window.scrollY = ${a.scrollY}  ${a.scrollY === 0 ? '✓ 页面没滚' : '★ 页面滚了'}`);
    if (clickedC === 'no-button') console.log('  ★ wheel 之后没出现「回到第 N 句」——跟随可能没停');
    else if (afterC.backBtn) console.log('  ★ 点了按钮后按钮还在');
    else console.log('  ✓ 点按钮后恢复跟随');

    ws.close();
  } catch (e) {
    console.error('出错：', e.message);
    code = 1;
  } finally {
    child.kill();
    await sleep(800);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  process.exit(code);
}

main();
