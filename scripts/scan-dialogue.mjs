/**
 * 扫描 srt，找「对话最密集」的连续 90 秒。
 *
 * 判断标准不只是句数多，还要：
 *   - 有来有回（不同说话人，用 - 记号或短句判断）
 *   - 句子够长（不是 "No." "Yeah." 这种）
 *   - 少音效行
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('用法: node scan-dialogue.mjs <file.srt>');
  process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function toSec(t) {
  const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return NaN;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

const blocks = raw.split(/\n\n+/).filter((b) => b.trim());
const cues = [];
for (const b of blocks) {
  const lines = b.split('\n');
  const ti = lines.findIndex((l) => l.includes('-->'));
  if (ti < 0) continue;
  const [a, z] = lines[ti].split('-->');
  const start = toSec(a);
  const end = toSec(z);
  if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
  const text = lines.slice(ti + 1).join(' ').trim();
  if (!text) continue;
  cues.push({ start, end, text });
}

console.log(`总句数: ${cues.length}`);

const isSound = (t) => /^[[(][^\])]*[\])]$/.test(t.trim());
const isDialogue = (t) => !isSound(t) && /[a-zA-Z]{2,}/.test(t);

// 划 90 秒窗口，步长 10 秒
const WIN = 90;
const STEP = 10;
const lastEnd = cues[cues.length - 1]?.end ?? 0;

const rows = [];
for (let t = 0; t + WIN <= lastEnd; t += STEP) {
  const inWin = cues.filter((c) => c.start >= t && c.start < t + WIN);
  const talk = inWin.filter((c) => isDialogue(c.text));
  const chars = talk.reduce((s, c) => s + c.text.length, 0);
  // 对话感：含 "- " 的多行（两人对话）、或短句交替
  const turnMarkers = talk.filter((c) => /^- /.test(c.text) || /\n- /.test(c.text)).length;
  rows.push({
    t,
    total: inWin.length,
    talk: talk.length,
    chars,
    turns: turnMarkers,
    score: talk.length * 2 + chars / 40 + turnMarkers * 1.5,
  });
}

rows.sort((a, b) => b.score - a.score);
console.log('\n=== 对话最密集的 8 个 90 秒窗口 ===');
for (const r of rows.slice(0, 8)) {
  const mm = String(Math.floor(r.t / 60)).padStart(2, '0');
  const ss = String(Math.floor(r.t % 60)).padStart(2, '0');
  console.log(
    `  ${mm}:${ss}  台词 ${String(r.talk).padStart(3)} 句 · ${String(r.chars).padStart(5)} 字符 · 轮次 ${r.turns}  · 得分 ${r.score.toFixed(1)}`
  );
}

const best = rows[0];
if (best) {
  console.log('\n=== 第一名窗口的台词 ===');
  const inWin = cues.filter((c) => c.start >= best.t && c.start < best.t + WIN);
  for (const c of inWin) {
    const mm = String(Math.floor(c.start / 60)).padStart(2, '0');
    const ss = String(Math.floor(c.start % 60)).padStart(2, '0');
    console.log(`  ${mm}:${ss}  ${c.text.replace(/\n/g, ' / ').slice(0, 70)}`);
  }
}
