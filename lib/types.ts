export type Difficulty = 'easy' | 'medium' | 'hard';
export type WorkType = 'movie' | 'series' | 'podcast';
export type SubtitleQuality = 'official' | 'curated' | 'auto';

export interface Work {
  slug: string;
  title: string;
  originalTitle: string;
  year: number;
  type: WorkType;
  genres: string[];
  rating: number;
  runtime?: string;
  difficulty: Difficulty;
  level: string;
  subtitleQuality: SubtitleQuality;
  tagline: string;
  description: string;
  whyLearn: string;
  phrases: string[];
  platforms: string[];
  /** 渐变兜底色，[亮, 暗] */
  accent: [string, string];
  /** 无封面时的大字母水印 */
  mark: string;
  /**
   * 封面图路径（/posters/<slug>.webp）。
   * 有图用图，图挂了浏览器会跳过 url()，露出下面的渐变——不需要 onError。
   */
  poster?: string;
}

export interface Cue {
  id: number;
  start: number;
  end: number;
  /** 主字幕行（英文优先） */
  text: string;
  /** 双语字幕里自带的中文行，和 translation 区分开 */
  native?: string;
  /** 用户点「翻译」生成的译文 */
  translation?: string;
  words?: { word: string; hint: string }[];
}

export interface SavedWord {
  word: string;
  sentence: string;
  translation: string;
  addedAt: number;
  clip?: SavedLineClip;
}

export type SavedLineClip = {
  videoId: string;
  videoName: string;
  start: number;
  end: number;
  source: { kind: 'sample'; video: string } | { kind: 'file'; name: string; size: number; type: string; lastModified: number };
};

export const difficultyLabel: Record<Difficulty, string> = {
  easy: '入门',
  medium: '进阶',
  hard: '挑战',
};

export const typeLabel: Record<WorkType, string> = {
  movie: '电影',
  series: '剧集',
  podcast: '播客',
};

export const subtitleLabel: Record<SubtitleQuality, string> = {
  official: '官方字幕',
  curated: '社区精校',
  auto: '机器生成',
};
