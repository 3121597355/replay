/**
 * 布局体检：确认 footer 已移除、构建指纹已显示、各区块高度是否合理。
 * 用法：node scripts/diag-layout.mjs [带视频]
 *   加 with-video 参数会先点示例视频，测真实播放状态的布局。
 */
import { spawn } from 'node:child_process';
import { BROWSER } from './browser.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 9335;
const URL = 'http://127.0.0.1:4310/learn';
const WITH_VIDEO = process.argv.includes('with-video');

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

const PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const H = (el) => el ? Math.round(el.getBoundingClientRect().height) : null;
  const T = (el) => el ? Math.round(el.getBoundingClientRect().top) : null;
  const learn = q('[data-page="learn"]');
  const left = learn ? learn.querySelector('.border-r') : null;
  const stage = left ? left.firstElementChild : null;
  const video = q('video');
  const ctrl = left && left.lastElementChild !== stage ? left.lastElementChild : null;
  const footer = q('footer');
  return {
    viewport: { w: innerWidth, h: innerHeight },
    scroll: { y: Math.round(scrollY), docH: document.documentElement.scrollHeight, bodyOverflow: getComputedStyle(document.body).overflow },
    footer: { exists: !!footer, top: T(footer), h: H(footer), display: footer ? getComputedStyle(footer).display : null },
    learn: { top: T(learn), h: H(learn) },
    left: { top: T(left), h: H(left), overflow: left ? getComputedStyle(left).overflowY : null },
    stage: { top: T(stage), h: H(stage) },
    video: video ? { top: T(video), h: H(video), maxH: getComputedStyle(video).maxHeight, objectFit: getComputedStyle(video).objectFit, vw: Math.round(video.getBoundingClientRect().width) } : null,
    ctrl: { top: T(ctrl), h: H(ctrl) },
    buildStamp: (() => {
      const el = [...document.querySelectorAll('span')].find(s => /^\\d{2}\\/\\d{2}\\s+\\d{2}:\\d{2}$/.test((s.textContent||'').trim()));
      return el ? el.textContent.trim() : null;
    })(),
  };
})()`;

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'edge-layout-'));
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
    const ver = await waitPort();
    const target = await pickTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = client(ws);
    await c.send('Runtime.enable');
    await sleep(2600);

    if (WITH_VIDEO) {
      console.log('加载示例视频（约 30 秒）…');
      await c.eval(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('示例视频'));
        if (b) b.click();
        return !!b;
      })()`);
      await sleep(32000);
    }

    const r = await c.eval(PROBE);
    console.log(`\n视口 ${r.viewport.w} × ${r.viewport.h}\n`);

    const line = (label, v) => console.log(`  ${label.padEnd(14)} ${v}`);
    console.log('=== 页面 ===');
    line('scrollY', `${r.scroll.y}  ${r.scroll.y === 0 ? '✓' : '★ 页面在滚'}`);
    line('docH', `${r.scroll.docH}  ${Math.abs(r.scroll.docH - r.viewport.h) <= 2 ? '✓ 等于视口' : `★ 比视口高 ${r.scroll.docH - r.viewport.h}px`}`);
    line('body overflow', r.scroll.bodyOverflow);

    console.log('\n=== footer ===');
    line('存在', `${r.footer.exists}  display=${r.footer.display}`);
    line('高度', `${r.footer.h}  ${r.footer.h === 0 ? '✓ 不占位' : '★ 还占位'}`);

    console.log('\n=== 垂直布局 ===');
    line('learn', `top=${r.learn.top}  h=${r.learn.h}`);
    line('左栏', `top=${r.left.top}  h=${r.left.h}  overflowY=${r.left.overflow}`);
    line('视频舞台', `top=${r.stage.top}  h=${r.stage.h}`);
    line('控制条', `top=${r.ctrl.top}  h=${r.ctrl.h}`);

    if (r.video) {
      console.log('\n=== 视频 ===');
      line('尺寸', `${r.video.vw} × ${r.video.h}`);
      line('maxHeight', r.video.maxH);
      line('objectFit', r.video.objectFit);
      const stageInner = r.stage.h - 24; // p-3 上下各 12
      const gap = stageInner - r.video.h;
      line('舞台留白', `${gap}px  ${Math.abs(gap) <= 6 ? '✓ 基本填满' : '★ 有空白'}`);
    } else {
      console.log('\n=== 视频 ===\n  未加载（加 with-video 参数可测播放态）');
    }

    console.log('\n=== 构建指纹 ===');
    line('BUILD_STAMP', r.buildStamp ?? '★ 没渲染出来');

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
