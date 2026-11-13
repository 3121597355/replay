/** MIME can be empty for local files; use the extension as a fallback. */
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'aac', 'flac'];
export const MEDIA_ACCEPT = `video/*,audio/*,.mkv,${AUDIO_EXTENSIONS.map(ext => `.${ext}`).join(',')}`;
export function isAudioSource(source?: { name: string; type: string }): boolean {
  return !!source && (source.type.startsWith('audio/') || AUDIO_EXTENSIONS.includes(source.name.split('.').pop()?.toLowerCase() || ''));
}
