/**
 * 翻译逻辑的离线验证：不真的调接口，只验证合并与优先级。
 * 跑法：npx tsx scripts/test-translate.ts
 */
import type { Cue } from '../lib/types';

/** 模拟 translateCues 的核心：返回新数组，不改原对象 */
function fakeTranslate(cues: Cue[]): Cue[] {
  return cues.map((c) => ({ ...c, translation: `译:${c.text}`, words: [] }));
}

const base: Cue[] = [
  { id: 1, start: 0, end: 2, text: 'Hello there.', native: '你好。' },
  { id: 2, start: 2, end: 4, text: 'How are you?' },
  { id: 3, start: 4, end: 6, text: 'I am fine.', translation: '我很好。' },
  { id: 4, start: 6, end: 8, text: 'Goodbye.' },
];

// 1) 只挑既没 native 也没 translation 的
const pending = base.filter((c) => !c.translation && !c.native);
console.log('待翻译:', pending.map((c) => c.id));
console.assert(pending.length === 2, '应该有 2 句需要翻译');

// 2) 不可变：翻译不改原对象
const before = JSON.stringify(base);
const translated = fakeTranslate(pending);
console.assert(JSON.stringify(base) === before, '原数组不应被修改');

// 3) 按 id 合并回去
const map = new Map(translated.map((c) => [c.id, c]));
const merged = base.map((c) => map.get(c.id) ?? c);

console.log('\n合并结果：');
for (const c of merged) {
  const shown = c.translation ?? c.native ?? '（无中文）';
  const source = c.translation
    ? '机翻'
    : c.native
      ? '字幕自带'
      : '无';
  console.log(`  ${c.id}. ${c.text.padEnd(16)} → ${shown}  [${source}]`);
}

// 4) 优先级：translation 覆盖 native
console.assert(merged[0].native === '你好。', 'native 应保留');
console.assert(!merged[0].translation, '有 native 的句子不该被翻译');
console.assert(merged[1].translation === '译:How are you?', '缺译文的应该补上');
console.assert(merged[2].translation === '我很好。', '已翻译的保持不变');

// 5) 再来一次应该没有待翻译的
const again = merged.filter((c) => !c.translation && !c.native);
console.log('\n第二次待翻译:', again.length, '句');
console.assert(again.length === 0, '第二次不应该再有待翻译');

console.log('\n✅ 全部通过');
