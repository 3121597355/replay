import type { Cue } from './types';

/**
 * 内置演示片段：一段日常对话，带翻译和生词。
 * 用户没有视频、没有字幕文件时，也能立刻体验完整的学习流程。
 */
export const demoCues: Cue[] = [
  {
    id: 1,
    start: 0.5,
    end: 3.2,
    text: "Hey, are you okay? You look like you've seen a ghost.",
    native: '嘿，你还好吧？看你这表情，跟见了鬼似的。',
    words: [
      { word: 'ghost', hint: '鬼魂；"seen a ghost" 形容极度震惊' },
    ],
  },
  {
    id: 2,
    start: 3.6,
    end: 6.8,
    text: "I'm fine. I just had the weirdest day of my life.",
    native: '我没事。只是今天是我这辈子最奇怪的一天。',
    words: [{ word: 'weird', hint: '奇怪的，古怪的' }],
  },
  {
    id: 3,
    start: 7.2,
    end: 11.0,
    text: "Weird how? Like, you-wore-your-shirt-backwards weird, or something actually happened?",
    native: '哪种奇怪？是你把衬衫穿反了那种，还是真出什么事了？',
    words: [
      { word: 'backwards', hint: '向后地，反着地' },
      { word: 'actually', hint: '实际上，真的' },
    ],
  },
  {
    id: 4,
    start: 11.4,
    end: 14.9,
    text: "Something actually happened. I ran into my ex at the coffee shop.",
    native: '真出事了。我在咖啡店撞见我前任了。',
    words: [
      { word: 'ran into', hint: '偶遇，撞见（run into 过去式）' },
      { word: 'ex', hint: '前任' },
    ],
  },
  {
    id: 5,
    start: 15.3,
    end: 18.0,
    text: "Oh no. Did you hide behind the magazine rack?",
    native: '糟了。你是不是躲到杂志架后面去了？',
    words: [{ word: 'rack', hint: '架子，搁架' }],
  },
  {
    id: 6,
    start: 18.4,
    end: 22.6,
    text: "Worse. I panicked and pretended to be on the phone for ten minutes.",
    native: '更糟。我慌了，假装打电话打了十分钟。',
    words: [
      { word: 'panicked', hint: '惊慌失措（panic 的过去式）' },
      { word: 'pretended', hint: '假装' },
    ],
  },
  {
    id: 7,
    start: 23.0,
    end: 26.4,
    text: "For ten minutes? Who were you even talking to?",
    native: '打了十分钟？你到底是跟谁在说话？',
    words: [{ word: 'even', hint: '用于强调' }],
  },
  {
    id: 8,
    start: 26.8,
    end: 31.2,
    text: "Nobody. I was just going, 'Mm-hmm, yeah, right, totally,' over and over.",
    native: '没人。我就一直"嗯嗯、对、没错、完全同意"念来念去。',
    words: [
      { word: 'over and over', hint: '一遍又一遍' },
      { word: 'totally', hint: '完全地（口语里也很常用于附和）' },
    ],
  },
  {
    id: 9,
    start: 31.6,
    end: 34.8,
    text: "That is genuinely the worst acting I have ever heard.",
    native: '这是我听过最烂的表演，没有之一。',
    words: [
      { word: 'genuinely', hint: '真正地，确实' },
      { word: 'acting', hint: '表演，演技' },
    ],
  },
  {
    id: 10,
    start: 35.2,
    end: 39.5,
    text: "I know. And then she walked over and said, 'Nice phone call.'",
    native: '我知道。然后她走过来说："电话打得不错啊。"',
    words: [{ word: 'walked over', hint: '走过来' }],
  },
  {
    id: 11,
    start: 39.9,
    end: 44.2,
    text: "So she knew the whole time. What did you say?",
    native: '所以她一直都知道了。你说了什么？',
    words: [{ word: 'the whole time', hint: '一直，全程' }],
  },
  {
    id: 12,
    start: 44.6,
    end: 49.0,
    text: "I said 'you too' and walked into a glass door.",
    native: '我说了句"你也是"，然后就撞玻璃门上了。',
    words: [
      { word: 'you too', hint: '常见误用：该说"thank you"时回"you too"' },
    ],
  },
  {
    id: 13,
    start: 49.4,
    end: 52.8,
    text: "Okay, that is a story worth telling at parties.",
    native: '好吧，这故事值得在聚会上讲一讲。',
    words: [
      { word: 'worth', hint: '值得的（worth + doing）' },
      { word: 'telling', hint: '讲述（tell 的动名词）' },
    ],
  },
  {
    id: 14,
    start: 53.2,
    end: 56.5,
    text: "It's not funny yet. Give it a week.",
    native: '现在还好笑不起来。等一周再说。',
    words: [{ word: 'give it a week', hint: '给它一周时间（口语常见表达）' }],
  },
];

export const demoTitle = '演示片段 · 一次尴尬的偶遇';
export const demoSubtitle = '一段 57 秒的日常对话，双语字幕 + 生词提示';
