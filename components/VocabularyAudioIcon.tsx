export default function VocabularyAudioIcon({ kind }: { kind: 'play' | 'speaker' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === 'play' ? <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></> : <><path d="M11 5 6 9H3v6h3l5 4Z" /><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></>}
  </svg>;
}
