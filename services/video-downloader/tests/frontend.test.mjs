import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (name) => fs.readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('contains the approved primary interface copy and semantic controls', async () => {
  const html = await read('index.html');
  for (const copy of ['视频下载器', '粘贴视频页面或媒体链接', '解析视频', '下载', '打开下载文件夹']) {
    assert.match(html, new RegExp(copy));
  }
  assert.match(html, /<form[^>]+id="resolveForm"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<template[^>]+id="mediaTemplate"/);
  assert.match(html, /<svg\b/);
});

test('uses a restrained responsive design system without gradients', async () => {
  const css = await read('styles.css');
  assert.match(css, /--accent:\s*#176b45/i);
  assert.match(css, /max-width:\s*920px/i);
  assert.match(css, /min-height:\s*52px/i);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/i);
  assert.match(css, /letter-spacing:\s*0/i);
  assert.doesNotMatch(css, /gradient\s*\(/i);
  assert.doesNotMatch(css, /font-size:\s*[^;]*(?:vw|dvw)/i);
});

test('connects the browser workflow to real APIs without remote innerHTML', async () => {
  const js = await read('app.js');
  for (const endpoint of ['/api/health', '/api/resolve', '/api/downloads', '/api/open-downloads']) {
    assert.match(js, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
  assert.match(js, /new AbortController\(\)/);
  assert.match(js, /textContent/);
  assert.match(js, /750/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
});

test('keeps the row action label consistent with completed state', async () => {
  const js = await read('app.js');
  assert.match(js, /task\.status === 'completed'[\s\S]*downloadButton[\s\S]*textContent = '已完成'/);
});

test('renders persistent download history and indeterminate progress states', async () => {
  const [html, css, js] = await Promise.all([
    read('index.html'), read('styles.css'), read('app.js'),
  ]);
  assert.match(html, /id="historySection"/);
  assert.match(html, /id="historyList"/);
  assert.match(html, /id="historyTemplate"/);
  assert.match(html, /清空记录/);
  assert.match(css, /progress-track\.is-indeterminate/);
  assert.match(js, /method:\s*'DELETE'/);
  assert.match(js, /loadHistory/);
  assert.match(js, /fileAvailable/);
  assert.match(js, /if \(progress > 0\) metrics\.push\(`\$\{Number\.isInteger\(progress\) \? progress : progress\.toFixed\(1\)\}%`\)/);
});

test('shows completed percentage and folder-open feedback', async () => {
  const js = await read('app.js');
  assert.match(js, /taskMetric\.textContent = `\$\{Math\.round\(Number\(task\.progress\) \|\| 100\)\}% · \$\{task\.filename \|\| 'MP4'\}`/);
  assert.match(js, /showStatus\('success', '已打开下载文件夹'/);
  assert.match(js, /openDownloads\((?:button|folderButton)\)/);
});

test('connects pause and resume controls to task endpoints', async () => {
  const [html, js] = await Promise.all([read('index.html'), read('app.js')]);
  assert.match(html, /class="button button-secondary task-toggle"/);
  assert.match(html, /class="button button-secondary history-toggle"/);
  assert.match(js, /task\.status === 'paused' \? 'resume' : 'pause'/);
  assert.match(js, /api\(`\/api\/downloads\/\$\{encodeURIComponent\(task\.id\)\}\/\$\{action\}`/);
  assert.match(js, /暂停下载/);
  assert.match(js, /继续下载/);
});

test('renders a single-record history delete control', async () => {
  const [html, js] = await Promise.all([read('index.html'), read('app.js')]);
  const actionsStart = html.indexOf('<div class="history-actions"');
  const actionsEnd = html.indexOf('</div>', actionsStart);
  const historyActions = html.slice(actionsStart, actionsEnd);
  assert.match(html, /class="button button-danger icon-button history-delete"/);
  assert.match(html, /aria-label="删除此条下载记录"/);
  assert.match(historyActions, /class="button button-danger icon-button history-delete"/);
  assert.match(js, /api\(`\/api\/downloads\/\$\{encodeURIComponent\(task\.id\)\}`, \{ method: 'DELETE' \}\)/);
  assert.match(js, /已删除下载记录/);
});

test('offers interactive browser verification for protected pages', async () => {
  const [html, js] = await Promise.all([read('index.html'), read('app.js')]);
  assert.match(html, /id="browserVerifyButton"/);
  assert.match(html, />在浏览器中验证</);
  assert.match(js, /BROWSER_VERIFICATION_REQUIRED/);
  assert.match(js, /api\('\/api\/browser-resolve'/);
  assert.match(js, /完成验证后.*开始播放视频/);
});
