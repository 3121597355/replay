/**
 * 滚动问题诊断。
 *
 * 起一个带 remote-debugging 的 headless Edge，用 CDP 实测：
 *   - 谁在滚（window / body / 页面里的容器）
 *   - body 锁有没有生效
 *   - 播放时 scrollY 会不会变
 *
 * 用法：node scripts/diag-scroll.mjs
 */
import { spawn } from 'node:child_process';
import { BROWSER } from './browser.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 9333;
const URL = 'http://127.0.0.1:4310/learn';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {
      /* 还没起来 */
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
        }, 20000);
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

const PROBE = `(() => {
  const learn = document.querySelector('[data-page="learn"]');
  const aside = learn ? learn.querySelector('aside') : null;
  const list = aside ? aside.querySelector('.overflow-y-auto') : null;
  const footer = document.querySelector('footer');
  const nav = document.querySelector('header') || document.querySelector('nav');
  const cs = (el) => el ? getComputedStyle(el) : null;
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; };
  return {
    scrollY: Math.round(window.scrollY),
    innerH: window.innerHeight,
    docScrollH: document.documentElement.scrollHeight,
    bodyScrollH: document.body.scrollHeight,
    docOverflow: cs(document.documentElement)?.overflow,
    bodyOverflow: cs(document.body)?.overflow,
    learnFound: !!learn,
    dataPage: learn ? learn.getAttribute('data-page') : null,
    learnRect: rect(learn),
    learnOverflow: cs(learn)?.overflow,
    navRect: rect(nav),
    footerRect: rect(footer),
    asideRect: rect(aside),
    asideOverflow: cs(aside)?.overflow,
    listRect: rect(list),
    listScrollH: list ? list.scrollHeight : null,
    listClientH: list ? list.clientHeight : null,
    listScrollable: list ? list.scrollHeight > list.clientHeight + 2 : null,
    listOverscroll: list ? cs(list).overscrollBehaviorY : null,
  };
})()`;

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'edge-diag-'));
  console.log('启动 headless Edge …');

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
    { stdio: 'ignore', detached: false }
  );

  let code = 0;
  try {
    const ver = await waitPort();
    console.log(`  ${ver.Browser}\n`);

    const target = await pickTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = makeClient(ws);
    await c.send('Runtime.enable');
    await sleep(2500);

    console.log('=== 初始状态（未加载视频）===');
    console.log(JSON.stringify(await c.eval(PROBE), null, 2));

    // 加载示例字幕
    console.log('\n点击「示例视频」…');
    const clicked = await c.eval(`(() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find(x => (x.textContent || '').includes('示例视频'));
      if (!b) return 'not-found';
      b.click();
      return 'clicked';
    })()`);
    console.log('  ', clicked);
    await sleep(32000);

    console.log('\n=== 字幕加载后 ===');
    const afterLoad = await c.eval(PROBE);
    console.log(JSON.stringify(afterLoad, null, 2));

    // 开始播放
    console.log('\n点击播放…');
    const played = await c.eval(`(() => {
      const v = document.querySelector('video');
      if (!v) return 'no-video';
      v.play().catch(() => {});
      return 'playing';
    })()`);
    console.log('  ', played);

    // 播放过程中连续采样 scrollY
    console.log('\n播放中采样 window.scrollY（每 1.5 秒，共 8 次）:');
    const samples = [];
    for (let i = 0; i < 8; i++) {
      await sleep(1500);
      const s = await c.eval(`({
        scrollY: Math.round(window.scrollY),
        t: document.querySelector('video')?.currentTime?.toFixed?.(1) ?? null,
        listTop: (() => { const l = document.querySelector('[data-page="learn"] aside .overflow-y-auto'); return l ? Math.round(l.scrollTop) : null; })(),
      })`);
      samples.push(s);
      console.log(`  ${String(i + 1).padStart(2)}  scrollY=${s.scrollY}  video=${s.t}s  listScrollTop=${s.listTop}`);
    }

    const moved = samples.some((s) => s.scrollY !== samples[0].scrollY);
    console.log(`\n结论：window.scrollY ${moved ? '★ 变化了 —— 页面确实在滚' : '✓ 始终没变'}`);

    const listMoved = samples.some((s) => s.listTop !== samples[0].listTop);
    console.log(`      list.scrollTop ${listMoved ? '✓ 在跟随（预期行为）' : '没动（可能没跟随，或字幕没加载）'}`);

    ws.close();
  } catch (e) {
    console.error('诊断出错：', e.message);
    code = 1;
  } finally {
    child.kill();
    await sleep(800);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  process.exit(code);
}

main();
