/**
 * 从一个大 srt 里切出一段，时间轴归零。
 * 用法: node cut-srt.mjs <in.srt> <startSec> <endSec> <out.srt>
 */
import fs from 'node:fs';

const [, , inPath, startArg, endArg, outPath] = process.argv;
if (!inPath || !startArg || !endArg || !outPath) {
  console.error('用法: node cut-srt.mjs <in.srt> <startSec> <endSec> <out.srt>');
  process.exit(1);
}

const START = Number(startArg);
const END = Number(endArg);
const raw = fs.readFileSync(inPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

function toSec(t) {
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return NaN;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

function fmt(sec) {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)},${String(ms).padStart(3, '0')}`;
}

const blocks = raw.split(/\n\n+/).filter((b) => b.trim());
const out = [];
let n = 0;

for (const b of blocks) {
  const lines = b.split('\n');
  const ti = lines.findIndex((l) => l.includes('-->'));
  if (ti < 0) continue;
  const [a, z] = lines[ti].split('-->');
  const s = toSec(a);
  const e = toSec(z);
  if (!Number.isFinite(s) || !Number.isFinite(e)) continue;

  // 只要整条落在窗口里的，避免半截字幕
  if (s < START || e > END) continue;

  const text = lines
    .slice(ti + 1)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  if (!text) continue;

  n++;
  out.push(`${n}\n${fmt(s - START)} --> ${fmt(e - START)}\n${text}`);
}

fs.writeFileSync(outPath, out.join('\n\n') + '\n', 'utf8');
console.log(`切出 ${n} 条 → ${outPath}`);
console.log(`区间 ${fmt(START)} ~ ${fmt(END)}，时长 ${END - START} 秒`);

// 预览前 5 条
console.log('\n--- 前 5 条 ---');
for (const b of out.slice(0, 5)) {
  const [i, t, ...rest] = b.split('\n');
  console.log(`${i}  ${t}`);
  for (const r of rest) console.log(`    ${r}`);
}
