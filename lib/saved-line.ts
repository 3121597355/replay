import type { Cue, SavedLineClip, SavedWord } from './types';
import type { LearningSession, LearningSource } from './learning-session';
import sample from '@/public/sample/manchester-repair-v2.json';

export function validSavedClip(value: unknown): value is SavedLineClip {
  if (!value || typeof value !== 'object') return false;
  const clip = value as SavedLineClip;
  if (typeof clip.videoId !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(clip.videoId) || typeof clip.videoName !== 'string' || clip.videoName.length > 300 || !Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end <= clip.start || clip.end - clip.start > 300 || clip.end > 172800) return false;
  const source = clip.source;
  return !!source && (source.kind === 'sample' ? source.video === sample.video : source.kind === 'file' && typeof source.name === 'string' && source.name.length <= 300 && Number.isFinite(source.size) && source.size > 0 && typeof source.type === 'string' && Number.isFinite(source.lastModified));
}
export function savedClipFor(cue: Cue, videoId: string, videoName: string, source: LearningSource): SavedLineClip | undefined {
  const clip: SavedLineClip = { videoId, videoName, start: cue.start, end: cue.end, source: source.kind === 'sample' ? { kind: 'sample', video: sample.video } : { ...source } };
  return validSavedClip(clip) ? clip : undefined;
}
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
export function legacySavedClip(word: SavedWord, session: LearningSession | null): SavedLineClip | undefined {
  if (validSavedClip(word.clip)) return word.clip;
  if (!session || !word.sentence.trim()) return;
  const matches = session.cues.filter(cue => normalize(cue.text) === normalize(word.sentence));
  // Repeated dialogue has no trustworthy original time in a legacy collection.
  if (matches.length !== 1) return;
  return savedClipFor(matches[0], session.id, session.videoName, session.source);
}
export function sameSavedVideo(clip: SavedLineClip, file: File): boolean {
  const source = clip.source;
  return source.kind === 'file' && file.name === source.name && file.size === source.size && file.lastModified === source.lastModified;
}
