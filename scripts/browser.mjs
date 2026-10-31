/**
 * 找一个可用的 Chromium 内核浏览器给 CDP 用。
 *
 * 优先读环境变量 BROWSER_PATH，其次按平台常见安装路径探测。
 * 用法：
 *   BROWSER_PATH=/path/to/chrome node scripts/shot.mjs ...
 */
import { existsSync } from 'node:fs';

const CANDIDATES = {
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ],
};

const found = process.env.BROWSER_PATH || (CANDIDATES[process.platform] ?? []).find((p) => existsSync(p));

if (!found) {
  throw new Error(
    '没找到 Chromium 内核浏览器。装一个 Chrome/Edge，或用 BROWSER_PATH 指定可执行文件路径。'
  );
}

export const BROWSER = found;
