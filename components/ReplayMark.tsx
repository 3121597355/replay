export default function ReplayMark({ className }: { className?: string }) {
  return <span className={className} aria-hidden="true">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 4.2A1.2 1.2 0 0 1 4.2 3h5.6A3.2 3.2 0 0 1 13 6.2v5.6A1.2 1.2 0 0 1 11.8 13H6.2A3.2 3.2 0 0 1 3 9.8V4.2Z" stroke="white" strokeWidth="1.4" />
      <path d="m6.6 6 3.4 2-3.4 2V6Z" fill="white" />
    </svg>
  </span>;
}
